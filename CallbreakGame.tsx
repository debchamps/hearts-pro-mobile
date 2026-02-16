
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState, Card, GamePhase, Player, HistoryItem, CallbreakRoundSummary, PlayerEmotion } from './types';
import { createDeck, shuffle } from './constants';
import { getCallbreakBid, getCallbreakMove } from './services/callbreakAi';
import { Avatar, CardView, Overlay, HistoryModal, CallbreakScorecardModal, AvatarSelectionModal } from './SharedComponents';
import { persistenceService } from './services/persistence';
import { leaderboardService } from './services/leaderboardService';
import { OnlineGameScreen } from './client/OnlineGameScreen';

const SOUNDS = {
  PLAY: 'https://cdn.pixabay.com/audio/2022/03/10/audio_f53093282f.mp3',
  CLEAR: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c3523e4291.mp3',
};
const OFFLINE_BOT_THINK_DELAY_MS = 450;

const playSound = (url: string, volume = 0.4) => {
  try {
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch (e) {}
};

export function CallbreakGame({ initialPlayers, initialState, onExit, soundEnabled, onlineMode = false }: { initialPlayers: Player[], initialState?: GameState | null, onExit: () => void, soundEnabled: boolean, onlineMode?: boolean }) {
  if (onlineMode) {
    return <OnlineGameScreen gameType="CALLBREAK" onExit={onExit} />;
  }

  const [gameState, setGameState] = useState<GameState>(initialState || {
    gameType: 'CALLBREAK',
    players: initialPlayers.map(p => ({ ...p, score: 0, tricksWon: 0 })),
    dealerIndex: 0,
    turnIndex: -1,
    leadSuit: null,
    currentTrick: [],
    heartsBroken: false,
    spadesBroken: true, 
    phase: 'DEALING',
    roundNumber: 1,
    passingCards: [],
    settings: { targetScore: 5, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, mandatoryOvertrump: false, enableEmojis: true },
    teamScores: [0, 0],
    teamBags: [0, 0],
    trickHistory: [],
    callbreakHistory: []
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [dragInfo, setDragInfo] = useState<{ id: string; startY: number; currentY: number } | null>(null);
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [editingAvatarPlayerId, setEditingAvatarPlayerId] = useState<number | null>(null);

  useEffect(() => {
    leaderboardService.getRank('CALLBREAK').then(setCurrentRank);
  }, []);

  useEffect(() => {
    if (gameState.phase !== 'GAME_OVER') {
      persistenceService.saveGame('CALLBREAK', gameState);
    } else {
      persistenceService.clearGame();
    }
  }, [gameState]);

  const triggerEmoji = useCallback((playerId: number, emotion: PlayerEmotion) => {
    if (!gameState.settings.enableEmojis) return;
    setGameState(prev => ({
      ...prev,
      players: prev.players.map(p => p.id === playerId ? { ...p, emotion } : p)
    }));
    setTimeout(() => {
      setGameState(prev => ({
        ...prev,
        players: prev.players.map(p => p.id === playerId ? { ...p, emotion: null } : p)
      }));
    }, 2500);
  }, [gameState.settings.enableEmojis]);

  const onDragStart = (e: React.MouseEvent | React.TouchEvent, id: string) => {
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    setDragInfo({ id, startY: clientY, currentY: clientY });
  };

  const onDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragInfo) return;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    setDragInfo(prev => prev ? { ...prev, currentY: clientY } : null);
  };

  const onDragEnd = (card: Card) => {
    if (!dragInfo) return;
    const diff = dragInfo.startY - dragInfo.currentY;
    if (diff > 60 || Math.abs(diff) < 10) {
      handleHumanPlay(card);
    }
    setDragInfo(null);
  };

  const isCardPlayable = useCallback((card: Card): boolean => {
    if (gameState.phase !== 'PLAYING' || gameState.turnIndex !== 0 || gameState.currentTrick.length >= 4 || clearingTrick) return true;
    const hand = gameState.players[0].hand;
    const leadSuit = gameState.leadSuit;
    if (!leadSuit) return true;
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);
    if (hasLeadSuit) return card.suit === leadSuit;
    const hasSpades = hand.some(c => c.suit === 'SPADES');
    if (hasSpades) return card.suit === 'SPADES';
    return true;
  }, [gameState.phase, gameState.turnIndex, gameState.leadSuit, gameState.players, gameState.currentTrick.length, clearingTrick]);

  const startRound = useCallback(() => {
    const deck = shuffle(createDeck(gameState.settings));
    const players = gameState.players.map((p, i) => ({
      ...p,
      hand: deck.slice(i * 13, (i + 1) * 13).sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return b.value - a.value;
      }),
      tricksWon: 0,
      bid: undefined
    }));
    setGameState(prev => ({
      ...prev,
      players,
      phase: 'BIDDING',
      turnIndex: (prev.dealerIndex + 1) % 4,
      currentTrick: [],
      leadSuit: null,
      trickHistory: []
    }));
    setMessage("Call your Bids (1-8)");
  }, [gameState.players, gameState.dealerIndex, gameState.settings]);

  useEffect(() => {
    if (gameState.phase === 'DEALING') {
      const timer = setTimeout(startRound, 600);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, startRound]);

  const playCard = useCallback((playerId: number, cardId: string) => {
    if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
    setGameState(prev => {
      const player = prev.players[playerId];
      const card = player.hand.find(c => c.id === cardId)!;
      return {
        ...prev,
        players: prev.players.map(p => p.id === playerId ? { ...p, hand: p.hand.filter(c => cardId !== c.id) } : p),
        currentTrick: [...prev.currentTrick, { playerId, card }],
        leadSuit: prev.currentTrick.length === 0 ? card.suit : prev.leadSuit,
        turnIndex: (prev.turnIndex + 1) % 4,
      };
    });
  }, [soundEnabled]);

  const handleBid = (bid: number) => {
    setGameState(prev => {
      const newPlayers = prev.players.map(p => p.id === 0 ? { ...p, bid } : p);
      const allBid = newPlayers.every(p => p.bid !== undefined);
      return { 
        ...prev, 
        players: newPlayers, 
        turnIndex: allBid ? (prev.dealerIndex + 1) % 4 : (prev.turnIndex + 1) % 4,
        phase: allBid ? 'PLAYING' : 'BIDDING'
      };
    });
  };

  useEffect(() => {
    if (gameState.phase === 'BIDDING' && gameState.turnIndex !== 0 && !isProcessing) {
      const runBid = async () => {
        setIsProcessing(true);
        await new Promise(r => setTimeout(r, 1200));
        const bid = await getCallbreakBid(gameState.players[gameState.turnIndex].hand);
        setGameState(prev => {
          const newPlayers = prev.players.map(p => p.id === prev.turnIndex ? { ...p, bid } : p);
          const allBid = newPlayers.every(p => p.bid !== undefined);
          return {
            ...prev,
            players: newPlayers,
            turnIndex: allBid ? (prev.dealerIndex + 1) % 4 : (prev.turnIndex + 1) % 4,
            phase: allBid ? 'PLAYING' : 'BIDDING'
          };
        });
        setIsProcessing(false);
      };
      runBid();
    }
  }, [gameState.phase, gameState.turnIndex, isProcessing, gameState.dealerIndex]);

  useEffect(() => {
    const activePlayer = gameState.players[gameState.turnIndex];
    if (gameState.phase === 'PLAYING' && activePlayer && !activePlayer.isHuman && !isProcessing && !clearingTrick && gameState.currentTrick.length < 4) {
      const runAi = async () => {
        setIsProcessing(true);
        await new Promise((r) => setTimeout(r, OFFLINE_BOT_THINK_DELAY_MS));
        const cardId = await getCallbreakMove(activePlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.settings.mandatoryOvertrump);
        if (cardId) playCard(gameState.turnIndex, cardId);
        setIsProcessing(false);
      };
      runAi();
    }
  }, [gameState.turnIndex, gameState.phase, isProcessing, clearingTrick, gameState.currentTrick.length, gameState.settings.mandatoryOvertrump]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) {
      setTimeout(() => {
        let winnerCard = gameState.currentTrick[0];
        let hadSpadeInTrick = winnerCard.card.suit === 'SPADES';

        for (let i = 1; i < 4; i++) {
          const curr = gameState.currentTrick[i];
          const isSpade = curr.card.suit === 'SPADES';
          if (isSpade) hadSpadeInTrick = true;
          const winIsSpade = winnerCard.card.suit === 'SPADES';
          if ((isSpade && !winIsSpade) || (curr.card.suit === winnerCard.card.suit && curr.card.value > winnerCard.card.value)) {
            winnerCard = curr;
          }
        }
        setClearingTrick({ winnerId: winnerCard.playerId });
        if (soundEnabled) playSound(SOUNDS.CLEAR, 0.4);

        // Emoji logic
        const winnersHighestWasSpade = winnerCard.card.suit === 'SPADES';
        if (winnersHighestWasSpade && gameState.currentTrick.some(t => t.playerId !== winnerCard.playerId && t.card.suit === 'SPADES')) {
            triggerEmoji(winnerCard.playerId, 'HAPPY'); // Won overtrump battle
        } else if (!winnersHighestWasSpade && gameState.currentTrick.some(t => t.card.value >= 13 && t.playerId !== winnerCard.playerId)) {
            triggerEmoji(winnerCard.playerId, 'HAPPY'); // Won against high cards
        }

        const historyItem: HistoryItem = { trick: [...gameState.currentTrick], winnerId: winnerCard.playerId, leadSuit: gameState.leadSuit };

        setTimeout(() => {
          setGameState(prev => {
            const newPlayers = prev.players.map(p => p.id === winnerCard.playerId ? { ...p, tricksWon: (p.tricksWon || 0) + 1 } : p);
            const newHistory = [...prev.trickHistory, historyItem];

            if (newPlayers[0].hand.length === 0) {
              const roundScores = newPlayers.map(p => {
                const success = (p.tricksWon || 0) >= (p.bid || 0);
                triggerEmoji(p.id, success ? 'HAPPY' : 'CRYING');
                const scoreChange = success ? (p.bid || 0) + ((p.tricksWon || 0) - (p.bid || 0)) / 10 : -(p.bid || 0);
                return { playerId: p.id, bid: p.bid || 0, tricks: p.tricksWon || 0, scoreChange, totalAfterRound: p.score + scoreChange };
              });

              const userRoundData = roundScores.find(s => s.playerId === 0);
              let submissionScore = (userRoundData?.scoreChange || 0) * 10;
              
              const summary: CallbreakRoundSummary = { roundNumber: prev.roundNumber, scores: roundScores };
              const over = prev.roundNumber >= 5;

              if (over) {
                const finalSorted = [...roundScores].sort((a,b) => b.totalAfterRound - a.totalAfterRound);
                const userMatchRank = finalSorted.findIndex(s => s.playerId === 0);
                const bonuses = [100, 50, 20, 0];
                submissionScore += bonuses[userMatchRank] || 0;
              }
              leaderboardService.submitGameScore('CALLBREAK', submissionScore);

              return { 
                ...prev, 
                players: newPlayers.map((p, i) => ({ ...p, score: roundScores[i].totalAfterRound })), 
                phase: over ? 'GAME_OVER' : 'ROUND_END', 
                currentTrick: [], leadSuit: null, 
                dealerIndex: (prev.dealerIndex + 1) % 4, 
                trickHistory: newHistory,
                callbreakHistory: [...(prev.callbreakHistory || []), summary]
              };
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winnerCard.playerId, trickHistory: newHistory };
          });
          setClearingTrick(null);
        }, 850);
      }, 800);
    }
  }, [gameState.currentTrick, soundEnabled, gameState.leadSuit, triggerEmoji]);

  const handleHumanPlay = (card: Card) => {
    if (gameState.turnIndex !== 0 || isProcessing || gameState.phase !== 'PLAYING' || clearingTrick) return;
    
    const hand = gameState.players[0].hand;
    const leadSuit = gameState.leadSuit;
    const hasLeadSuit = hand.some(c => c.suit === leadSuit);
    const hasSpades = hand.some(c => c.suit === 'SPADES');

    if (leadSuit) {
        if (hasLeadSuit) {
            if (card.suit !== leadSuit) {
                setMessage(`Must follow suit: ${leadSuit}`);
                return;
            }
        } else if (hasSpades) {
            if (card.suit !== 'SPADES') {
                setMessage("Must play a Spade if void of lead suit!");
                return;
            }
        }
    }

    if (gameState.settings.mandatoryOvertrump && gameState.currentTrick.length > 0) {
        let currentWinningSpadeVal = -1;
        gameState.currentTrick.forEach(t => { if (t.card.suit === 'SPADES' && t.card.value > currentWinningSpadeVal) currentWinningSpadeVal = t.card.value; });
        if (currentWinningSpadeVal > -1) {
            const betterSpades = hand.filter(c => c.suit === 'SPADES' && c.value > currentWinningSpadeVal);
            const canOvertrump = betterSpades.length > 0;
            const isPlayingSpade = card.suit === 'SPADES';
            if (isPlayingSpade && canOvertrump && card.value < currentWinningSpadeVal) {
                setMessage("Mandatory Overtrump: Play a higher Spade!");
                return;
            }
        }
    }
    playCard(0, card.id);
  };

  const handLayout = useMemo(() => {
    const hand = gameState.players[0].hand;
    const count = hand.length;
    if (count === 0) return [];
    const containerWidth = window.innerWidth - 32;
    const isPlayerTurn = gameState.phase === 'PLAYING' && gameState.turnIndex === 0;
    const weights = hand.map(card => isPlayerTurn && isCardPlayable(card) ? 1.4 : 0.6);
    const sumWeights = weights.reduce((s, w) => s + w, 0);
    const gapPerWeight = count > 1 ? Math.max(0, containerWidth - 88) / sumWeights : 0;
    let currentX = (containerWidth - (sumWeights * gapPerWeight + 88)) / 2 + 16;
    return hand.map((card, idx) => {
        const x = currentX;
        currentX += weights[idx] * gapPerWeight;
        return { card, x, isPlayable: isCardPlayable(card) };
    });
  }, [gameState.players[0].hand, gameState.phase, gameState.turnIndex, isCardPlayable]);

  const updateAvatar = (avatar: string) => {
    if (editingAvatarPlayerId === null) return;
    setGameState(prev => ({
      ...prev,
      players: prev.players.map(p => p.id === editingAvatarPlayerId ? { ...p, avatar } : p)
    }));
    setEditingAvatarPlayerId(null);
  };

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden text-white" onMouseMove={onDragMove} onTouchMove={onDragMove}>
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 border-b border-purple-500/20">
        <div className="flex gap-2">
            <button onClick={onExit} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">🏠</button>
            <button onClick={() => setGameState(p => ({ ...p, settings: { ...p.settings, enableEmojis: !p.settings.enableEmojis } }))} className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-lg border transition-all ${gameState.settings.enableEmojis ? 'bg-green-600 border-green-400' : 'bg-gray-700 border-gray-500'}`}>
                {gameState.settings.enableEmojis ? '😊' : '🚫'}
            </button>
        </div>
        <div className="flex flex-col items-center">
            <span className="text-[10px] font-black text-purple-400 uppercase tracking-widest leading-none">Round</span>
            <span className="text-2xl font-black italic text-yellow-500 leading-tight">{gameState.roundNumber}/5</span>
        </div>
        <div className="flex gap-2">
            <button onClick={() => setShowScorecard(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">📊</button>
            <button onClick={() => setShowHistory(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">📜</button>
        </div>
      </div>

      <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-[100] w-full flex justify-center pointer-events-none px-6">
        {message && <div className="bg-purple-600 text-white px-6 py-2 rounded-full text-[11px] font-black uppercase shadow-2xl tracking-widest border border-white/20 animate-deal pointer-events-auto">{message}</div>}
      </div>

      <div className="h-[70%] relative w-full">
        {gameState.players.map((p, i) => {
            const pos = [ "bottom-6 left-1/2 -translate-x-1/2", "top-1/2 right-2 -translate-y-1/2", "top-6 left-1/2 -translate-x-1/2", "top-1/2 left-2 -translate-y-1/2" ][i];
            return <Avatar key={p.id} player={p} pos={pos} active={gameState.turnIndex === i} isWinner={clearingTrick?.winnerId === i} gameType="CALLBREAK" phase={gameState.phase} onClick={() => setEditingAvatarPlayerId(i)} emojisEnabled={gameState.settings.enableEmojis} />;
        })}

        {/* TRICK AREA */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18rem] h-[18rem] flex items-center justify-center pointer-events-none">
          {gameState.currentTrick.map((t, idx) => {
             const offsets = [{x:0,y:45,rot:'2deg'}, {x:60,y:0,rot:'5deg'}, {x:0,y:-45,rot:'-3deg'}, {x:-60,y:0,rot:'-6deg'}];
             const off = offsets[t.playerId];
             const winDir = [{x:0,y:500}, {x:400,y:0}, {x:0,y:-500}, {x:-400,y:0}][clearingTrick?.winnerId ?? 0];
             const startPos = [{x:0,y:350}, {x:400,y:0}, {x:0,y:-350}, {x:-400,y:0}][t.playerId];
             return (
               <div key={idx} className={`absolute transition-all animate-play ${clearingTrick ? 'animate-clear' : ''}`} 
                style={{ 
                  '--play-x': `${off.x}px`, 
                  '--play-y': `${off.y}px`, 
                  '--play-rot': off.rot, 
                  '--start-x': `${startPos.x}px`, 
                  '--start-y': `${startPos.y}px`, 
                  '--clear-x': `${winDir.x}px`, 
                  '--clear-y': `${winDir.y}px`, 
                  zIndex: 10 + idx 
                } as any}>
                 <CardView card={t.card} size="md" />
               </div>
             );
          })}
        </div>

        {gameState.phase === 'BIDDING' && gameState.turnIndex === 0 && (
          <div className="absolute bottom-[10%] left-1/2 -translate-x-1/2 bg-black/85 p-6 rounded-[2.5rem] border border-purple-500/40 backdrop-blur-3xl shadow-2xl z-[200] flex flex-col items-center w-[90%] max-w-xs animate-fadeIn pointer-events-auto">
             <h3 className="text-yellow-500 font-black uppercase text-[11px] tracking-[0.3em] mb-4 text-center">How many tricks?</h3>
             <div className="grid grid-cols-4 gap-2">
               {[1,2,3,4,5,6,7,8].map(b => (
                 <button 
                  key={b} 
                  onClick={() => handleBid(b)} 
                  className="w-12 h-12 rounded-xl bg-purple-600/20 hover:bg-purple-600 text-white font-black text-lg transition-all active:scale-90 border border-purple-500/20 flex items-center justify-center"
                 > 
                  {b} 
                 </button>
               ))}
             </div>
             <p className="mt-4 text-white/30 text-[8px] font-black uppercase tracking-widest">Select target tricks</p>
          </div>
        )}
      </div>

      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black to-transparent overflow-visible">
        <div className="relative w-full flex-1">
           {handLayout.map((item, idx) => (
              <div key={item.card.id} onMouseDown={(e) => onDragStart(e, item.card.id)} onTouchStart={(e) => onDragStart(e, item.card.id)} onMouseUp={() => onDragEnd(item.card)} onTouchEnd={() => onDragEnd(item.card)}
                className={`absolute card-fan-item animate-deal cursor-grab ${dragInfo?.id === item.card.id ? 'z-[500]' : ''}`}
                style={{ transform: `translate3d(${item.x}px, ${Math.pow(idx - (handLayout.length-1)/2, 2) * 0.45 + (dragInfo?.id === item.card.id ? dragInfo.currentY - dragInfo.startY : 0)}px, 0) rotate(${(idx - (handLayout.length-1)/2)*1.5}deg) scale(${dragInfo?.id === item.card.id ? 1.15 : (gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && !item.isPlayable ? 0.95 : 1)})`, zIndex: 100 + idx }}
              >
                <CardView card={item.card} size="lg" inactive={gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && !item.isPlayable} />
              </div>
           ))}
        </div>
      </div>

      {showHistory && <HistoryModal history={gameState.trickHistory} players={gameState.players} onClose={() => setShowHistory(false)} />}
      {showScorecard && <CallbreakScorecardModal history={gameState.callbreakHistory || []} players={gameState.players} onClose={() => setShowScorecard(false)} />}
      {editingAvatarPlayerId !== null && (
        <AvatarSelectionModal 
          currentAvatar={gameState.players[editingAvatarPlayerId].avatar} 
          onSelect={updateAvatar} 
          onClose={() => setEditingAvatarPlayerId(null)} 
        />
      )}

      {(gameState.phase === 'ROUND_END' || gameState.phase === 'GAME_OVER') && (
        <Overlay title={gameState.phase === 'GAME_OVER' ? "SERIES FINISHED" : "ROUND COMPLETE"} subtitle="Cumulative Scores">
            <div className="w-full space-y-3 mb-8 max-h-[40vh] overflow-y-auto">
               {gameState.players.map(p => (
                 <div key={p.id} className="flex justify-between items-center bg-purple-900/20 p-4 rounded-3xl border border-purple-500/20">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center bg-white/10">
                        {p.avatar.startsWith('data:image') ? <img src={p.avatar} className="w-full h-full object-cover" alt="Avatar" /> : <span className="text-3xl">{p.avatar}</span>}
                      </div>
                      <div className="text-left leading-none"><span className="font-black text-sm uppercase">{p.name}</span><br/><span className="text-[8px] opacity-40 font-bold uppercase">Tricks: {p.tricksWon}/{p.bid}</span></div>
                    </div>
                    <div className="text-2xl font-black italic text-yellow-500">{(p.score).toFixed(1)}</div>
                 </div>
               ))}
            </div>
            <div className="flex gap-2 w-full">
                <button onClick={() => setShowScorecard(true)} className="flex-1 py-4 bg-white/10 rounded-2xl font-black text-xs uppercase">Detailed Table</button>
                <button onClick={() => { if (gameState.phase === 'GAME_OVER') onExit(); else { setGameState(p => ({ ...p, phase: 'DEALING', roundNumber: p.roundNumber + 1 })); } }} className="flex-[2] py-4 bg-purple-600 rounded-2xl font-black text-lg uppercase shadow-xl border-b-4 border-purple-800 active:translate-y-1">CONTINUE</button>
            </div>
        </Overlay>
      )}
    </div>
  );
}
