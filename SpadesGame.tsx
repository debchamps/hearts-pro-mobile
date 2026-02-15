
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState, Card, GamePhase, GameSettings, Player, HistoryItem, SpadesRoundSummary, PlayerEmotion } from './types';
import { createDeck, shuffle } from './constants';
import { getSpadesBid, getSpadesMove } from './services/spadesAi';
import { Avatar, CardView, Overlay, HistoryModal, HowToPlayModal, ScorecardModal, AvatarSelectionModal } from './SharedComponents';
import { persistenceService } from './services/persistence';
import { leaderboardService } from './services/leaderboardService';

const SOUNDS = {
  PLAY: 'https://cdn.pixabay.com/audio/2022/03/10/audio_f53093282f.mp3',
  CLEAR: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c3523e4291.mp3',
};

const playSound = (url: string, volume = 0.4) => {
  try {
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch (e) {}
};

export function SpadesGame({ initialPlayers, initialState, onExit, soundEnabled }: { initialPlayers: Player[], initialState?: GameState | null, onExit: () => void, soundEnabled: boolean }) {
  const [gameState, setGameState] = useState<GameState>(initialState || {
    gameType: 'SPADES',
    players: initialPlayers,
    dealerIndex: 0,
    turnIndex: -1,
    leadSuit: null,
    currentTrick: [],
    heartsBroken: false,
    spadesBroken: false,
    phase: 'DEALING',
    roundNumber: 1,
    passingCards: [],
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false, enableEmojis: true },
    teamScores: [0, 0],
    teamBags: [0, 0],
    trickHistory: [],
    spadesHistory: []
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [hintCardId, setHintCardId] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{ id: string; startY: number; currentY: number } | null>(null);
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  const [editingAvatarPlayerId, setEditingAvatarPlayerId] = useState<number | null>(null);

  useEffect(() => {
    leaderboardService.getRank('SPADES').then(setCurrentRank);
  }, []);

  useEffect(() => {
    if (gameState.phase !== 'GAME_OVER') {
      persistenceService.saveGame('SPADES', gameState);
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
    const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);
    if (gameState.leadSuit && hasLeadSuit) return card.suit === gameState.leadSuit;
    if (!gameState.leadSuit && card.suit === 'SPADES' && !gameState.spadesBroken) {
        return hand.every(c => c.suit === 'SPADES');
    }
    return true;
  }, [gameState.phase, gameState.turnIndex, gameState.leadSuit, gameState.players, gameState.spadesBroken, gameState.currentTrick.length, clearingTrick]);

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
      spadesBroken: false,
      trickHistory: []
    }));
    setMessage("Place your Bids");
  }, [gameState.players, gameState.dealerIndex, gameState.settings]);

  useEffect(() => {
    if (gameState.phase === 'DEALING') {
      const timer = setTimeout(startRound, 600);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, startRound]);

  const playCard = useCallback((playerId: number, cardId: string) => {
    if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
    if (playerId === 0) setMessage("");
    setGameState(prev => {
      if (prev.currentTrick.length >= 4) return prev;
      const player = prev.players[playerId];
      const card = player.hand.find(c => c.id === cardId)!;
      const newPlayers = prev.players.map(p => p.id === playerId ? { ...p, hand: p.hand.filter(c => cardId !== c.id) } : p);
      return {
        ...prev,
        players: newPlayers,
        currentTrick: [...prev.currentTrick, { playerId, card }],
        leadSuit: prev.currentTrick.length === 0 ? card.suit : prev.leadSuit,
        spadesBroken: prev.spadesBroken || card.suit === 'SPADES',
        turnIndex: (prev.turnIndex + 1) % 4,
      };
    });
    setHintCardId(null);
  }, [soundEnabled]);

  const handleBid = (bid: number) => {
    setMessage("");
    setGameState(prev => {
      const newPlayers = prev.players.map(p => p.id === 0 ? { ...p, bid } : p);
      const allBid = newPlayers.every(p => p.bid !== undefined);
      if (allBid) setMessage("");
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
        const player = gameState.players[gameState.turnIndex];
        const bid = await getSpadesBid(player.hand);
        setGameState(prev => {
          const newPlayers = prev.players.map(p => p.id === prev.turnIndex ? { ...p, bid } : p);
          const allBid = newPlayers.every(p => p.bid !== undefined);
          if (allBid) setMessage("");
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
        const cardId = await getSpadesMove(activePlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.spadesBroken, gameState.players, gameState.turnIndex);
        if (cardId) playCard(gameState.turnIndex, cardId);
        setIsProcessing(false);
      };
      runAi();
    }
  }, [gameState.turnIndex, gameState.phase, isProcessing, clearingTrick, gameState.currentTrick.length]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) {
      setTimeout(() => {
        let winnerCard = gameState.currentTrick[0];
        for (let i = 1; i < 4; i++) {
          const curr = gameState.currentTrick[i];
          if (curr.card.suit === winnerCard.card.suit) { if (curr.card.value > winnerCard.card.value) winnerCard = curr; }
          else if (curr.card.suit === 'SPADES') { if (winnerCard.card.suit !== 'SPADES' || curr.card.value > winnerCard.card.value) winnerCard = curr; }
        }
        
        setClearingTrick({ winnerId: winnerCard.playerId });
        if (soundEnabled) playSound(SOUNDS.CLEAR, 0.4);

        // Emoji logic
        const winnerObj = gameState.players[winnerCard.playerId];
        if (winnerObj.bid !== undefined && (winnerObj.tricksWon || 0) >= winnerObj.bid && winnerObj.bid !== 0) {
           triggerEmoji(winnerCard.playerId, 'CRYING'); // Bagging
        } else if (winnerCard.card.suit === 'SPADES' && winnerCard.card.value >= 12) {
           triggerEmoji(winnerCard.playerId, 'HAPPY');
        }

        const historyItem: HistoryItem = {
          trick: [...gameState.currentTrick],
          winnerId: winnerCard.playerId,
          leadSuit: gameState.leadSuit
        };

        setTimeout(() => {
          setGameState(prev => {
            const newPlayers = prev.players.map(p => p.id === winnerCard.playerId ? { ...p, tricksWon: (p.tricksWon || 0) + 1 } : p);
            const newHistory = [...prev.trickHistory, historyItem];

            if (newPlayers[0].hand.length === 0) {
              const calculateTeamResult = (playerA: Player, playerB: Player, currentBags: number) => {
                let roundScore = 0;
                let bagsGained = 0;
                const nilResults: { playerId: number; success: boolean }[] = [];
                let remainingTricks = (playerA.tricksWon || 0) + (playerB.tricksWon || 0);
                let standardBid = 0;
                [playerA, playerB].forEach(p => {
                  if (p.bid === 0) {
                    const success = (p.tricksWon || 0) === 0;
                    roundScore += success ? 100 : -100;
                    nilResults.push({ playerId: p.id, success });
                    triggerEmoji(p.id, success ? 'HAPPY' : 'CRYING');
                  } else {
                    standardBid += (p.bid || 0);
                  }
                });
                [playerA, playerB].forEach(p => { if (p.bid === 0) { remainingTricks -= (p.tricksWon || 0); } });
                if (standardBid > 0) {
                    if (remainingTricks >= standardBid) {
                        roundScore += (standardBid * 10) + (remainingTricks - standardBid);
                        bagsGained = (remainingTricks - standardBid);
                        [playerA, playerB].forEach(p => { if (p.bid !== 0) triggerEmoji(p.id, 'HAPPY'); });
                    } else {
                        roundScore -= (standardBid * 10);
                        [playerA, playerB].forEach(p => { if (p.bid !== 0) triggerEmoji(p.id, 'CRYING'); });
                    }
                }
                let finalBags = currentBags + bagsGained;
                let bagPenalty = false;
                if (finalBags >= 10) {
                    roundScore -= 100;
                    finalBags -= 10;
                    bagPenalty = true;
                    [playerA, playerB].forEach(p => triggerEmoji(p.id, 'CRYING'));
                }
                return { bid: (playerA.bid || 0) + (playerB.bid || 0), tricks: (playerA.tricksWon || 0) + (playerB.tricksWon || 0), scoreChange: roundScore, bags: bagsGained, finalBags, nilResults, bagPenalty };
              };
              const r0 = calculateTeamResult(newPlayers[0], newPlayers[2], prev.teamBags[0]);
              const r1 = calculateTeamResult(newPlayers[1], newPlayers[3], prev.teamBags[1]);
              const summary: SpadesRoundSummary = {
                roundNumber: prev.roundNumber,
                team0: { bid: r0.bid, tricks: r0.tricks, scoreChange: r0.scoreChange, bags: r0.bags, nilResults: r0.nilResults, bagPenalty: r0.bagPenalty },
                team1: { bid: r1.bid, tricks: r1.tricks, scoreChange: r1.scoreChange, bags: r1.bags, nilResults: r1.nilResults, bagPenalty: r1.bagPenalty }
              };
              const newTeamScores: [number, number] = [prev.teamScores[0] + r0.scoreChange, prev.teamScores[1] + r1.scoreChange];
              const newTeamBags: [number, number] = [r0.finalBags, r1.finalBags];
              const over = newTeamScores[0] >= 500 || newTeamScores[1] >= 500;
              
              let submissionScore = r0.scoreChange;
              if (over && newTeamScores[0] >= 500 && newTeamScores[0] > newTeamScores[1]) {
                submissionScore += 100;
              }
              leaderboardService.submitGameScore('SPADES', submissionScore);

              return { 
                ...prev, 
                players: newPlayers, 
                teamScores: newTeamScores, 
                teamBags: newTeamBags, 
                phase: over ? 'GAME_OVER' : 'ROUND_END', 
                currentTrick: [], 
                leadSuit: null, 
                dealerIndex: (prev.dealerIndex + 1) % 4, 
                trickHistory: newHistory,
                spadesHistory: [...(prev.spadesHistory || []), summary]
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
    if (!isCardPlayable(card)) {
        const hand = gameState.players[0].hand;
        const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);
        if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) setMessage(`Must follow ${gameState.leadSuit}`);
        else if (!gameState.leadSuit && card.suit === 'SPADES' && !gameState.spadesBroken) setMessage("Spades not broken");
        return;
    }
    playCard(0, card.id);
  };

  const CARD_WIDTH = 88;
  const SIDE_MARGIN = 16; 

  const handLayout = useMemo(() => {
    const hand = gameState.players[0].hand;
    const count = hand.length;
    if (count === 0) return [];
    
    const containerWidth = window.innerWidth - (SIDE_MARGIN * 2);
    const isPlayerTurn = gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && gameState.currentTrick.length < 4 && !clearingTrick;

    const weights = hand.map(card => {
        if (!isPlayerTurn) return 1.0;
        return isCardPlayable(card) ? 1.4 : 0.6;
    });

    const sumWeights = weights.reduce((s, w) => s + w, 0);
    const availableGapWidth = Math.max(0, containerWidth - CARD_WIDTH);
    const gapPerWeight = count > 1 ? availableGapWidth / sumWeights : 0;
    
    let currentX = (containerWidth - (sumWeights * gapPerWeight + CARD_WIDTH)) / 2 + SIDE_MARGIN;

    return hand.map((card, idx) => {
        const x = currentX;
        currentX += weights[idx] * gapPerWeight;
        return { card, x, isPlayable: isCardPlayable(card) };
    });
  }, [gameState.players[0].hand, gameState.phase, gameState.turnIndex, gameState.currentTrick.length, clearingTrick, isCardPlayable]);

  const updateAvatar = (avatar: string) => {
    if (editingAvatarPlayerId === null) return;
    setGameState(prev => ({
      ...prev,
      players: prev.players.map(p => p.id === editingAvatarPlayerId ? { ...p, avatar } : p)
    }));
    setEditingAvatarPlayerId(null);
  };

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden" onMouseMove={onDragMove} onTouchMove={onDragMove}>
      {/* HEADER */}
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <div className="flex gap-2">
          <button onClick={onExit} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">🏠</button>
          <button onClick={() => setGameState(p => ({ ...p, settings: { ...p.settings, enableEmojis: !p.settings.enableEmojis } }))} className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-lg border transition-all ${gameState.settings.enableEmojis ? 'bg-green-600 border-green-400' : 'bg-gray-700 border-gray-500'}`}>
            {gameState.settings.enableEmojis ? '😊' : '🚫'}
          </button>
          <button onClick={() => setShowHowToPlay(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">?</button>
        </div>
        <div className="flex items-center bg-black/60 rounded-xl overflow-hidden border border-white/10 h-10 w-52 shadow-lg">
          <div className="flex-1 bg-blue-700 h-full flex flex-col items-center justify-center leading-none">
            <span className="text-[14px] font-black">{gameState.teamScores[0]}</span>
            <span className="text-[7px] font-black opacity-50">BLUE</span>
          </div>
          <div className="w-10 h-full bg-black/40 flex items-center justify-center text-lg font-black text-yellow-500 italic cursor-pointer active:scale-90 transition-transform hover:bg-white/10" onClick={() => setShowScorecard(true)}>
            📊
          </div>
          <div className="flex-1 bg-rose-700 h-full flex flex-col items-center justify-center leading-none">
            <span className="text-[14px] font-black">{gameState.teamScores[1]}</span>
            <span className="text-[7px] font-black opacity-50">RED</span>
          </div>
        </div>
        <button onClick={() => setShowHistory(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">📜</button>
      </div>

      <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-[100] w-full flex justify-center pointer-events-none px-6">
        {message && (
          <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-[11px] font-black uppercase shadow-2xl tracking-widest border-2 border-white/30 animate-deal pointer-events-auto">
            {message}
          </div>
        )}
      </div>

      <div className="h-[70%] relative w-full">
        {gameState.players.map((p, i) => {
            const positions = ["bottom-6 left-1/2 -translate-x-1/2", "top-1/2 right-2 -translate-y-1/2", "top-6 left-1/2 -translate-x-1/2", "top-1/2 left-2 -translate-y-1/2"];
            return (
              <Avatar 
                key={p.id} 
                player={p} 
                pos={positions[i]} 
                active={gameState.turnIndex === i} 
                isWinner={clearingTrick?.winnerId === i} 
                gameType="SPADES" 
                phase={gameState.phase} 
                onClick={() => setEditingAvatarPlayerId(i)}
                emojisEnabled={gameState.settings.enableEmojis}
              />
            );
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
                 style={{ '--play-x':`${off.x}px`,'--play-y':`${off.y}px`,'--play-rot':off.rot,'--start-x':`${startPos.x}px`,'--start-y':`${startPos.y}px`,'--clear-x':`${winDir.x}px`,'--clear-y':`${winDir.y}px`,zIndex:10+idx } as any}>
                 <CardView card={t.card} size="md" />
               </div>
             );
          })}
        </div>

        <div className="absolute bottom-[25%] left-1/2 -translate-x-1/2 w-full flex flex-col items-center z-50 px-10 text-center pointer-events-none">
           {gameState.phase === 'BIDDING' && gameState.turnIndex === 0 && (
             <div className="bg-black/85 p-6 rounded-[2.5rem] border border-white/20 backdrop-blur-2xl shadow-2xl pointer-events-auto flex flex-col items-center max-w-xs animate-fadeIn">
               <h3 className="text-yellow-500 font-black uppercase text-[11px] tracking-[0.3em] mb-4 animate-pulse">How many tricks?</h3>
               <div className="grid grid-cols-5 gap-2">
                 {[1,2,3,4,5,6,7,8,9,10,11,12,13].map(b => (
                   <button key={b} onClick={() => handleBid(b)} className="w-10 h-10 rounded-xl bg-white/10 hover:bg-yellow-500 hover:text-black font-black text-sm transition-all active:scale-90 border border-white/5"> {b} </button>
                 ))}
                 <button onClick={() => handleBid(0)} className="col-span-2 h-10 rounded-xl bg-rose-600 hover:bg-rose-500 font-black text-[10px] uppercase border border-white/10">NIL</button>
               </div>
             </div>
           )}
        </div>
      </div>

      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black/95 via-black/40 to-transparent overflow-visible">
        <div className="relative w-full flex-1">
           {handLayout.map((item, idx, arr) => {
             const { card, x: tx, isPlayable } = item;
             const centerIdx = (arr.length - 1) / 2;
             const ty = Math.pow(idx - centerIdx, 2) * 0.45;
             const isDragging = dragInfo?.id === card.id;
             const isDimmed = gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && !isPlayable;
             return (
                <div key={card.id} onMouseDown={(e) => onDragStart(e, card.id)} onTouchStart={(e) => onDragStart(e, card.id)} onMouseUp={() => onDragEnd(card)} onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab ${isDragging ? 'z-[500]' : ''}`}
                  style={{ transform: `translate3d(${tx}px, ${ty + (isDragging ? dragInfo.currentY - dragInfo.startY : 0)}px, 0) rotate(${(idx-centerIdx)*1.5}deg) scale(${isDragging?1.15:(isDimmed?0.95:1)})`, zIndex: isDragging?500:100+idx, animationDelay: `${idx*0.015}s` }}
                >
                  <CardView card={card} size="lg" highlighted={isDragging && Math.abs(dragInfo.currentY-dragInfo.startY)>=50} hint={hintCardId === card.id} inactive={isDimmed} />
                </div>
             );
           })}
        </div>
      </div>

      {showHistory && <HistoryModal history={gameState.trickHistory} players={gameState.players} onClose={() => setShowHistory(false)} />}
      {showHowToPlay && <HowToPlayModal gameType="SPADES" onClose={() => setShowHowToPlay(false)} />}
      {showScorecard && <ScorecardModal history={gameState.spadesHistory || []} currentScores={gameState.teamScores} currentBags={gameState.teamBags} onClose={() => setShowScorecard(false)} />}
      {editingAvatarPlayerId !== null && <AvatarSelectionModal currentAvatar={gameState.players[editingAvatarPlayerId].avatar} onSelect={updateAvatar} onClose={() => setEditingAvatarPlayerId(null)} />}

      {(gameState.phase === 'ROUND_END' || gameState.phase === 'GAME_OVER') && (
        <Overlay title={gameState.phase === 'GAME_OVER' ? "FINAL SCORES" : "ROUND END"} subtitle="Standings Update">
            <div className="w-full space-y-4 mb-12">
               <div className="bg-blue-600/20 p-5 rounded-[2rem] border-2 border-blue-500/50 flex justify-between items-center shadow-2xl backdrop-blur-lg">
                  <div className="text-left"><div className="text-[11px] font-black text-blue-400 uppercase tracking-[0.25em] mb-1">Team Blue</div><div className="text-4xl font-black italic text-white">{gameState.teamScores[0]}</div></div>
                  <div className="text-right text-[11px] text-white/50 font-black uppercase">Bags: {gameState.teamBags[0]}/10</div>
               </div>
               <div className="bg-rose-600/20 p-5 rounded-[2rem] border-2 border-rose-500/50 flex justify-between items-center shadow-2xl backdrop-blur-lg">
                  <div className="text-left"><div className="text-[11px] font-black text-rose-400 uppercase tracking-[0.25em] mb-1">Team Red</div><div className="text-4xl font-black italic text-white">{gameState.teamScores[1]}</div></div>
                  <div className="text-right text-[11px] text-white/50 font-black uppercase">Bags: {gameState.teamBags[1]}/10</div>
               </div>
            </div>
            <div className="flex gap-3 w-full">
                <button onClick={() => setShowScorecard(true)} className="flex-1 h-14 bg-white/10 rounded-2xl font-black text-sm uppercase shadow-xl border-white/5 tracking-[0.1em] active:translate-y-1 transition-all">Details</button>
                <button onClick={() => { if (gameState.phase === 'GAME_OVER') onExit(); else { setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1})); } }} 
                className="flex-[2] h-14 bg-green-600 rounded-2xl font-black text-lg uppercase shadow-xl border-green-800 tracking-[0.1em] active:translate-y-1 transition-all">CONTINUE</button>
            </div>
        </Overlay>
      )}
    </div>
  );
}
