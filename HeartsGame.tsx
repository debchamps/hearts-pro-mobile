
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState, Card, GamePhase, Player, Suit, HistoryItem, TrickCard, PlayerEmotion } from './types';
import { createDeck, shuffle } from './constants';
import { getBestMove } from './services/heartsAi';
import { i18n } from './services/i18n';
import { Avatar, CardView, Overlay, HistoryModal, HowToPlayModal, AvatarSelectionModal } from './SharedComponents';
import { persistenceService } from './services/persistence';
import { OnlineGameScreen } from './client/OnlineGameScreen';

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

export function HeartsGame({ initialPlayers, initialState, onExit, soundEnabled, onlineMode = false }: { initialPlayers: Player[], initialState?: GameState | null, onExit: () => void, soundEnabled: boolean, onlineMode?: boolean }) {
  if (onlineMode) {
    return <OnlineGameScreen gameType="HEARTS" onExit={onExit} />;
  }

  const [gameState, setGameState] = useState<GameState>(initialState || {
    gameType: 'HEARTS',
    players: initialPlayers.map(p => ({...p, score: 0, currentRoundScore: 0, tricksWon: 0})),
    dealerIndex: 0,
    turnIndex: -1,
    leadSuit: null,
    currentTrick: [],
    heartsBroken: false,
    spadesBroken: false,
    phase: 'DEALING',
    roundNumber: 1,
    passingCards: [],
    settings: { targetScore: 100, shootTheMoon: true, noPassing: false, jackOfDiamonds: false, enableEmojis: true },
    teamScores: [0, 0],
    teamBags: [0, 0],
    trickHistory: []
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [hintCardId, setHintCardId] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{ id: string; startY: number; currentY: number } | null>(null);
  const [editingAvatarPlayerId, setEditingAvatarPlayerId] = useState<number | null>(null);

  const t = (path: string, params?: any) => i18n.t(path, params);

  useEffect(() => {
    if (gameState.phase !== 'GAME_OVER') {
      persistenceService.saveGame('HEARTS', gameState);
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
    if (gameState.phase === 'PASSING') {
      handleHumanInteract(card);
    } else if (diff > 60 || Math.abs(diff) < 10) {
      handleHumanInteract(card);
    }
    setDragInfo(null);
  };

  const isCardPlayable = useCallback((card: Card, playerIdx: number): boolean => {
    if (gameState.phase !== 'PLAYING' || gameState.turnIndex !== playerIdx || gameState.currentTrick.length >= 4 || clearingTrick) return true;
    const player = gameState.players[playerIdx];
    const hand = player.hand;
    const totalCardsLeft = gameState.players.reduce((s, p) => s + p.hand.length, 0);
    const isFirstTrick = totalCardsLeft === 52;
    const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);

    if (isFirstTrick && !gameState.leadSuit) return card.id === '2-CLUBS';
    if (gameState.leadSuit && hasLeadSuit) return card.suit === gameState.leadSuit;
    if (!gameState.leadSuit && card.suit === 'HEARTS' && !gameState.heartsBroken) {
      return hand.every(c => c.suit === 'HEARTS');
    }
    return true;
  }, [gameState.phase, gameState.turnIndex, gameState.leadSuit, gameState.players, gameState.heartsBroken, clearingTrick]);

  const startRound = useCallback(() => {
    const deck = shuffle(createDeck(gameState.settings));
    const players = gameState.players.map((p, i) => ({
      ...p,
      hand: deck.slice(i * 13, (i + 1) * 13).sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return b.value - a.value;
      }),
      currentRoundScore: 0
    }));

    const cycle = (gameState.roundNumber - 1) % 4;
    const isPassing = !gameState.settings.noPassing && cycle !== 3;

    setGameState(prev => {
      let turnIdx = -1;
      if (!isPassing) {
        players.forEach((p, i) => { if (p.hand.some(c => c.id === '2-CLUBS')) turnIdx = i; });
      }
      return { 
        ...prev, players, phase: isPassing ? 'PASSING' : 'PLAYING', 
        currentTrick: [], leadSuit: null, heartsBroken: false, 
        turnIndex: turnIdx, passingCards: [], trickHistory: []
      };
    });
    
    if (isPassing) {
      const paths = ["hearts.pass_3_left", "hearts.pass_3_right", "hearts.pass_3_across"];
      setMessage(t(paths[cycle]));
    } else {
      setMessage(t("hearts.lead_2_clubs"));
    }
  }, [gameState.players, gameState.settings, gameState.roundNumber]);

  useEffect(() => {
    if (gameState.phase === 'DEALING') {
      const timer = setTimeout(startRound, 800);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, startRound]);

  const handleConfirmPass = useCallback(() => {
    if (gameState.passingCards.length !== 3) return;
    setIsProcessing(true);
    setMessage("");
    setTimeout(() => {
      setGameState(prev => {
        const cycle = (prev.roundNumber - 1) % 4;
        const players = prev.players.map(p => ({ ...p, hand: [...p.hand] }));
        const passes: Card[][] = players.map((p, i) => {
          if (i === 0 && p.isHuman) return p.hand.filter(c => prev.passingCards.includes(c.id));
          return [...p.hand].sort((a, b) => b.value - a.value).slice(0, 3);
        });

        players.forEach((p, i) => {
          const passIds = passes[i].map(c => c.id);
          p.hand = p.hand.filter(c => !passIds.includes(c.id));
        });

        const targets = cycle === 0 ? [1, 2, 3, 0] : cycle === 1 ? [3, 0, 1, 2] : [2, 3, 0, 1];
        passes.forEach((cards, sourceIdx) => {
          const targetIdx = targets[sourceIdx];
          players[targetIdx].hand = [...players[targetIdx].hand, ...cards].sort((a, b) => {
            if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
            return b.value - a.value;
          });
        });

        let starter = 0;
        players.forEach((p, i) => { if (p.hand.some(c => c.id === '2-CLUBS')) starter = i; });
        return { ...prev, players, phase: 'PLAYING', turnIndex: starter, passingCards: [] };
      });
      setMessage(t("hearts.lead_2_clubs"));
      setIsProcessing(false);
    }, 1200);
  }, [gameState.passingCards, gameState.roundNumber]);

  const playCard = useCallback((playerId: number, cardId: string) => {
    if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
    setGameState(prev => {
      const player = prev.players[playerId];
      const card = player.hand.find(c => c.id === cardId)!;
      const nextTurnIndex = (prev.turnIndex + 1) % 4;
      return {
        ...prev,
        players: prev.players.map(p => p.id === playerId ? { ...p, hand: p.hand.filter(c => cardId !== c.id) } : p),
        currentTrick: [...prev.currentTrick, { playerId, card }],
        leadSuit: prev.currentTrick.length === 0 ? card.suit : prev.leadSuit,
        heartsBroken: prev.heartsBroken || card.suit === 'HEARTS',
        turnIndex: nextTurnIndex,
      };
    });
    setHintCardId(null);
  }, [soundEnabled]);

  useEffect(() => {
    const activePlayer = gameState.players[gameState.turnIndex];
    if (gameState.phase === 'PLAYING' && activePlayer && !activePlayer.isHuman && !isProcessing && !clearingTrick && gameState.currentTrick.length < 4) {
      const runAi = async () => {
        setIsProcessing(true);
        await new Promise(r => setTimeout(r, 1000));
        const cardId = getBestMove(activePlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.heartsBroken, gameState.players.reduce((s,p)=>s+p.hand.length,0) === 52, gameState.players, gameState.turnIndex, gameState.settings);
        if (cardId) playCard(gameState.turnIndex, cardId);
        setIsProcessing(false);
      };
      runAi();
    }
  }, [gameState.turnIndex, gameState.phase, isProcessing, clearingTrick, gameState.currentTrick.length, playCard, gameState.leadSuit, gameState.heartsBroken, gameState.players, gameState.settings]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) {
      setTimeout(() => {
        let winner = gameState.currentTrick[0];
        for (let i = 1; i < 4; i++) {
          const curr = gameState.currentTrick[i];
          if (curr.card.suit === winner.card.suit && curr.card.value > winner.card.value) winner = curr;
        }
        setClearingTrick({ winnerId: winner.playerId });
        if (soundEnabled) playSound(SOUNDS.CLEAR, 0.4);
        
        const historyItem: HistoryItem = { trick: [...gameState.currentTrick], winnerId: winner.playerId, leadSuit: gameState.leadSuit };
        const trickPoints = gameState.currentTrick.reduce((s, t) => s + t.card.points, 0);
        const hasQS = gameState.currentTrick.some(t => t.card.id === 'Q-SPADES');
        const numHearts = gameState.currentTrick.filter(t => t.card.suit === 'HEARTS').length;
        
        if (hasQS || numHearts >= 3) triggerEmoji(winner.playerId, 'CRYING');
        else if (trickPoints === 0 && gameState.currentTrick.some(t => t.card.value >= 12)) triggerEmoji(winner.playerId, 'HAPPY');

        setTimeout(() => {
          setGameState(prev => {
            const currentPoints = prev.currentTrick.reduce((s, t) => s + t.card.points, 0);
            const newPlayers = prev.players.map(p => p.id === winner.playerId ? { ...p, currentRoundScore: p.currentRoundScore + currentPoints } : p);
            const newHistory = [...prev.trickHistory, historyItem];

            if (newPlayers[0].hand.length === 0) {
              let shooterId = -1;
              if (prev.settings.shootTheMoon) newPlayers.forEach(p => { if (p.currentRoundScore === 26) shooterId = p.id; });
              if (shooterId !== -1) triggerEmoji(shooterId, 'HAPPY');
              const finalPlayers = newPlayers.map(p => ({ ...p, score: p.score + (shooterId !== -1 ? (p.id === shooterId ? 0 : 26) : p.currentRoundScore), currentRoundScore: 0 }));
              const over = finalPlayers.some(p => p.score >= prev.settings.targetScore);
              return { ...prev, players: finalPlayers, phase: over ? 'GAME_OVER' : 'ROUND_END', currentTrick: [], leadSuit: null, dealerIndex: (prev.dealerIndex + 1) % 4, trickHistory: newHistory };
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winner.playerId, trickHistory: newHistory };
          });
          setClearingTrick(null);
        }, 850);
      }, 800);
    }
  }, [gameState.currentTrick, soundEnabled, gameState.leadSuit, triggerEmoji]);

  const handleHumanInteract = (card: Card) => {
    if (isProcessing || clearingTrick) return;
    const playerIdx = gameState.turnIndex;
    if (gameState.phase === 'PASSING') {
      setGameState(prev => {
        const alreadySelected = prev.passingCards.includes(card.id);
        if (alreadySelected) return { ...prev, passingCards: prev.passingCards.filter(id => id !== card.id) };
        else if (prev.passingCards.length < 3) return { ...prev, passingCards: [...prev.passingCards, card.id] };
        return prev;
      });
      return;
    }
    if (gameState.phase === 'PLAYING') {
      if (!gameState.players[playerIdx].isHuman) return;
      if (!isCardPlayable(card, playerIdx)) {
        if (card.id !== '2-CLUBS' && !gameState.leadSuit) setMessage(t("hearts.lead_2_clubs"));
        else if (gameState.leadSuit && card.suit !== gameState.leadSuit) setMessage(t("hearts.must_follow_suit", { suit: gameState.leadSuit }));
        else if (!gameState.leadSuit && card.suit === 'HEARTS' && !gameState.heartsBroken) setMessage(t("hearts.hearts_not_broken"));
        return;
      }
      playCard(playerIdx, card.id);
    }
  };

  const handLayout = useMemo(() => {
    const playerIdx = 0; 
    const player = gameState.players[playerIdx];
    if (!player || !player.hand) return [];
    const hand = player.hand;
    const containerWidth = window.innerWidth - 32;
    const isPlayerTurn = gameState.phase === 'PLAYING' && player.isHuman && gameState.turnIndex === playerIdx && gameState.currentTrick.length < 4 && !clearingTrick;
    const weights = hand.map(card => (isPlayerTurn || gameState.phase === 'PASSING') && isCardPlayable(card, playerIdx) ? 1.4 : 0.6);
    const sumWeights = weights.reduce((s, w) => s + w, 0);
    const gapPerWeight = hand.length > 1 ? Math.max(0, containerWidth - 88) / sumWeights : 0;
    let currentX = (containerWidth - (sumWeights * gapPerWeight + 88)) / 2 + 16;
    return hand.map((card, idx) => {
        const x = currentX;
        currentX += weights[idx] * gapPerWeight;
        return { card, x, isPlayable: isCardPlayable(card, playerIdx) };
    });
  }, [gameState.players, gameState.turnIndex, gameState.phase, gameState.currentTrick.length, clearingTrick, isCardPlayable]);

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
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <div className="flex gap-2">
          <button onClick={onExit} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">🏠</button>
          <button onClick={() => setShowHowToPlay(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">?</button>
        </div>
        <div className="text-center">
          <span className="text-[8px] text-white/40 font-black uppercase tracking-widest block leading-none mb-1">{t('common.round')}</span>
          <span className="text-3xl font-black italic text-yellow-500">{gameState.roundNumber}</span>
        </div>
        <div className="flex gap-2">
           <button onClick={() => setGameState(p => ({ ...p, settings: { ...p.settings, enableEmojis: !p.settings.enableEmojis } }))} className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-lg border transition-all ${gameState.settings.enableEmojis ? 'bg-green-600 border-green-400' : 'bg-gray-700 border-gray-500'}`}>{gameState.settings.enableEmojis ? '😊' : '🚫'}</button>
           <button onClick={() => setShowHistory(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">📜</button>
        </div>
      </div>

      <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-[100] w-full flex justify-center pointer-events-none px-6">
        {message && <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-[11px] font-black uppercase shadow-2xl tracking-widest border-2 border-white/30 animate-deal pointer-events-auto">{message}</div>}
      </div>

      <div className="h-[70%] relative w-full">
        {gameState.players.map((p, i) => {
            const positions = ["bottom-6 left-1/2 -translate-x-1/2", "top-1/2 right-4 -translate-y-1/2", "top-6 left-1/2 -translate-x-1/2", "top-1/2 left-4 -translate-y-1/2"];
            return <Avatar key={p.id} player={p} pos={positions[i]} active={gameState.turnIndex === i} isWinner={clearingTrick?.winnerId === i} phase={gameState.phase} onClick={() => setEditingAvatarPlayerId(i)} emojisEnabled={gameState.settings.enableEmojis} />;
        })}

        {gameState.phase === 'PASSING' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] z-[20] w-[90%] max-w-sm flex flex-col items-center animate-fadeIn">
            <div className="bg-[#121212] border-2 border-[#eab308] rounded-[3rem] p-8 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.9)] w-full flex flex-col items-center relative overflow-hidden">
              <div className="mb-6 text-center">
                <h3 className="text-[#eab308] font-black uppercase text-[12px] tracking-[0.4em] mb-1">STRATEGIC PASS</h3>
                <div className="text-white text-3xl font-black italic tracking-tighter uppercase leading-none">{t('common.continue')}</div>
              </div>
              <div className="flex gap-4 mb-8">
                {[0, 1, 2].map(i => (
                  <div key={i} className="staged-slot w-[75px] h-[100px] rounded-xl flex items-center justify-center border-2 border-white/10">
                    <span className="text-white/5 font-black text-4xl">{gameState.passingCards[i] ? '✓' : '?'}</span>
                  </div>
                ))}
              </div>
              <button disabled={gameState.passingCards.length !== 3} onClick={handleConfirmPass} className={`w-full h-14 rounded-2xl font-black text-lg uppercase transition-all shadow-xl ${gameState.passingCards.length === 3 ? 'bg-yellow-500 text-black active:translate-y-1' : 'bg-white/5 text-white/20'}`}>
                {gameState.passingCards.length < 3 ? `CHOOSE ${3-gameState.passingCards.length}` : t('common.confirm')}
              </button>
            </div>
          </div>
        )}

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[20rem] h-[20rem] flex items-center justify-center pointer-events-none">
          {gameState.currentTrick.map((t, idx) => {
             const off = [{x:0,y:45}, {x:60,y:0}, {x:0,y:-45}, {x:-60,y:0}][t.playerId];
             const winDir = [{x:0,y:600}, {x:500,y:0}, {x:0,y:-600}, {x:-500,y:0}][clearingTrick?.winnerId ?? 0];
             const startPos = [{x:0,y:350}, {x:400,y:0}, {x:0,y:-350}, {x:-400,y:0}][t.playerId];
             return (
               <div key={idx} className={`absolute animate-play ${clearingTrick ? 'animate-clear' : ''}`} 
                style={{ 
                  '--play-x':`${off.x}px`,
                  '--play-y':`${off.y}px`,
                  '--play-rot':'0deg',
                  '--start-x':`${startPos.x}px`,
                  '--start-y':`${startPos.y}px`,
                  '--clear-x':`${winDir.x}px`,
                  '--clear-y':`${winDir.y}px`,
                  zIndex:10+idx 
                } as any}>
                 <CardView card={t.card} size="md" />
               </div>
             );
          })}
        </div>
      </div>

      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black via-black/40 to-transparent">
        <div className="relative w-full flex-1">
           {handLayout.map((item, idx, arr) => {
             const { card, x } = item;
             const isDragging = dragInfo?.id === card.id;
             const isSelectedForPass = gameState.passingCards.includes(card.id);
             return (
                <div key={card.id} onMouseDown={(e) => onDragStart(e, card.id)} onTouchStart={(e) => onDragStart(e, card.id)} onMouseUp={() => onDragEnd(card)} onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab ${isDragging || isSelectedForPass ? 'z-[600]' : ''}`}
                  style={{ transform: `translate3d(${x}px, ${Math.pow(idx - (arr.length-1)/2, 2) * 0.4 + (isDragging ? dragInfo.currentY - dragInfo.startY : (isSelectedForPass ? -120 : 0))}px, 0) rotate(${(idx - (arr.length-1)/2)*2}deg) scale(${isDragging ? 1.15 : 1})`, zIndex: isDragging ? 600 : 100 + idx }}
                >
                  <CardView card={card} size="lg" highlighted={isSelectedForPass} hint={hintCardId === card.id} inactive={gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && !item.isPlayable} />
                </div>
             );
           })}
        </div>
      </div>

      {(gameState.phase === 'ROUND_END' || gameState.phase === 'GAME_OVER') && (
        <Overlay title={gameState.phase === 'GAME_OVER' ? t('hearts.game_over') : t('hearts.round_end')} subtitle={t('common.scoreboard')}>
            <div className="w-full space-y-3 mb-10">
               {gameState.players.map(p => (
                 <div key={p.id} className="flex justify-between items-center bg-white/5 p-4 rounded-3xl border border-white/10">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 flex items-center justify-center">
                        {p.avatar.startsWith('data:image') ? <img src={p.avatar} className="w-full h-full object-cover" /> : <span className="text-3xl">{p.avatar}</span>}
                      </div>
                      <div className="text-left"><span className="font-black text-sm uppercase block leading-none mb-1">{p.name}</span><span className="text-[9px] opacity-30 font-bold uppercase">{t('common.score')}: {p.score}</span></div>
                    </div>
                    <div className="text-2xl font-black italic text-yellow-500">+{p.currentRoundScore}</div>
                 </div>
               ))}
            </div>
            <button onClick={() => { if (gameState.phase === 'GAME_OVER') onExit(); else { setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1})); } }} className="w-full py-5 rounded-3xl font-black text-2xl bg-yellow-500 text-black uppercase shadow-2xl active:translate-y-1 transition-all">{t('common.continue')}</button>
        </Overlay>
      )}
      {editingAvatarPlayerId !== null && <AvatarSelectionModal currentAvatar={gameState.players[editingAvatarPlayerId].avatar} onSelect={updateAvatar} onClose={() => setEditingAvatarPlayerId(null)} />}
      {showHistory && <HistoryModal history={gameState.trickHistory} players={gameState.players} onClose={() => setShowHistory(false)} />}
      {showHowToPlay && <HowToPlayModal gameType="HEARTS" onClose={() => setShowHowToPlay(false)} />}
    </div>
  );
}
