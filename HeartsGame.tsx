
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GameState, Card, GamePhase, GameSettings, Player, Suit, HistoryItem } from './types';
import { createDeck, shuffle } from './constants';
import { getBestMove } from './services/heartsAi';
import { Avatar, CardView, Overlay, HistoryModal, HowToPlayModal } from './SharedComponents';
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

export function HeartsGame({ initialPlayers, initialState, onExit, soundEnabled }: { initialPlayers: Player[], initialState?: GameState | null, onExit: () => void, soundEnabled: boolean }) {
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
    settings: { targetScore: 100, shootTheMoon: true, noPassing: false, jackOfDiamonds: false },
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
  const [currentRank, setCurrentRank] = useState<number | null>(null);
  
  const passingDialogRef = useRef<HTMLDivElement>(null);
  const handContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    leaderboardService.getRank('HEARTS').then(setCurrentRank);
  }, []);

  useEffect(() => {
    if (gameState.phase !== 'GAME_OVER') {
      persistenceService.saveGame('HEARTS', gameState);
    } else {
      persistenceService.clearGame();
    }
  }, [gameState]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(""), 2000);
      return () => clearTimeout(timer);
    }
  }, [message]);

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

  const isCardPlayable = useCallback((card: Card): boolean => {
    if (gameState.phase !== 'PLAYING' || gameState.turnIndex !== 0 || gameState.currentTrick.length >= 4 || clearingTrick) return true;
    
    const hand = gameState.players[0].hand;
    const isFirstTrick = gameState.players.reduce((s, p) => s + p.hand.length, 0) === 52;
    const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);

    if (isFirstTrick && !gameState.leadSuit) return card.id === '2-CLUBS';
    if (gameState.leadSuit && hasLeadSuit) return card.suit === gameState.leadSuit;
    if (!gameState.leadSuit && card.suit === 'HEARTS' && !gameState.heartsBroken) {
      return hand.every(c => c.suit === 'HEARTS');
    }
    return true;
  }, [gameState.phase, gameState.turnIndex, gameState.leadSuit, gameState.players, gameState.heartsBroken, gameState.currentTrick.length, clearingTrick]);

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
        ...prev, 
        players, 
        phase: isPassing ? 'PASSING' : 'PLAYING', 
        currentTrick: [], 
        leadSuit: null, 
        heartsBroken: false, 
        turnIndex: turnIdx,
        passingCards: [],
        trickHistory: []
      };
    });
    
    if (isPassing) {
      const directions = ["Left", "Right", "Across"];
      setMessage(`Pass 3 Cards ${directions[cycle]}`);
    } else {
      setMessage("2 of Clubs Leads");
    }
  }, [gameState.players, gameState.settings, gameState.roundNumber]);

  useEffect(() => {
    if (gameState.phase === 'DEALING') {
      const timer = setTimeout(startRound, 600);
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
          if (i === 0) {
            return p.hand.filter(c => prev.passingCards.includes(c.id));
          } else {
            return [...p.hand].sort((a, b) => b.value - a.value).slice(0, 3);
          }
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
        return {
          ...prev,
          players,
          phase: 'PLAYING',
          turnIndex: starter,
          passingCards: []
        };
      });
      setMessage("2 of Clubs Leads");
      setIsProcessing(false);
    }, 1000);
  }, [gameState.passingCards, gameState.roundNumber]);

  const playCard = useCallback((playerId: number, cardId: string) => {
    if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
    if (playerId === 0) setMessage("");
    setGameState(prev => {
      const player = prev.players[playerId];
      const card = player.hand.find(c => c.id === cardId)!;
      const newPlayers = prev.players.map(p => p.id === playerId ? { ...p, hand: p.hand.filter(c => cardId !== c.id) } : p);
      return {
        ...prev,
        players: newPlayers,
        currentTrick: [...prev.currentTrick, { playerId, card }],
        leadSuit: prev.currentTrick.length === 0 ? card.suit : prev.leadSuit,
        heartsBroken: prev.heartsBroken || card.suit === 'HEARTS',
        turnIndex: (prev.turnIndex + 1) % 4,
      };
    });
    setHintCardId(null);
  }, [soundEnabled]);

  useEffect(() => {
    const activePlayer = gameState.players[gameState.turnIndex];
    if (gameState.phase === 'PLAYING' && activePlayer && !activePlayer.isHuman && !isProcessing && !clearingTrick && gameState.currentTrick.length < 4) {
      const runAi = async () => {
        setIsProcessing(true);
        await new Promise(r => setTimeout(r, 800));
        const cardId = getBestMove(
          activePlayer.hand, 
          gameState.currentTrick, 
          gameState.leadSuit, 
          gameState.heartsBroken, 
          gameState.players.reduce((s,p)=>s+p.hand.length,0) === 52, 
          gameState.players,
          gameState.turnIndex,
          gameState.settings
        );
        if (cardId) playCard(gameState.turnIndex, cardId);
        setIsProcessing(false);
      };
      runAi();
    }
  }, [gameState.turnIndex, gameState.phase, isProcessing, clearingTrick, gameState.currentTrick.length]);

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
        
        const historyItem: HistoryItem = {
          trick: [...gameState.currentTrick],
          winnerId: winner.playerId,
          leadSuit: gameState.leadSuit
        };

        setTimeout(() => {
          setGameState(prev => {
            const trickPoints = prev.currentTrick.reduce((s, t) => s + t.card.points, 0);
            const newPlayers = prev.players.map(p => p.id === winner.playerId ? { ...p, currentRoundScore: p.currentRoundScore + trickPoints } : p);
            const newHistory = [...prev.trickHistory, historyItem];

            if (newPlayers[0].hand.length === 0) {
              let shooterId = -1;
              if (prev.settings.shootTheMoon) newPlayers.forEach(p => { if (p.currentRoundScore === 26) shooterId = p.id; });
              const finalPlayers = newPlayers.map(p => ({ ...p, score: p.score + (shooterId !== -1 ? (p.id === shooterId ? 0 : 26) : p.currentRoundScore), currentRoundScore: 0 }));
              const over = finalPlayers.some(p => p.score >= prev.settings.targetScore);
              
              if (over) {
                const sorted = [...finalPlayers].sort((a,b) => a.score - b.score);
                const userRank = sorted.findIndex(p => p.id === 0);
                const bonuses = [100, 50, 20, 0];
                const bonus = bonuses[userRank] || 0;
                leaderboardService.submitGameScore('HEARTS', bonus);
              }

              return { ...prev, players: finalPlayers, phase: over ? 'GAME_OVER' : 'ROUND_END', currentTrick: [], leadSuit: null, dealerIndex: (prev.dealerIndex + 1) % 4, trickHistory: newHistory };
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winner.playerId, trickHistory: newHistory };
          });
          setClearingTrick(null);
        }, 850);
      }, 800);
    }
  }, [gameState.currentTrick, soundEnabled, gameState.leadSuit]);

  const handleHumanInteract = (card: Card) => {
    if (isProcessing || clearingTrick) return;
    if (gameState.phase === 'PASSING') {
      setGameState(prev => {
        const alreadySelected = prev.passingCards.includes(card.id);
        if (alreadySelected) {
          return { ...prev, passingCards: prev.passingCards.filter(id => id !== card.id) };
        } else if (prev.passingCards.length < 3) {
          return { ...prev, passingCards: [...prev.passingCards, card.id] };
        }
        return prev;
      });
      return;
    }
    if (gameState.phase === 'PLAYING') {
      if (gameState.turnIndex !== 0) return;
      if (!isCardPlayable(card)) {
        const hand = gameState.players[0].hand;
        const isFirstTrick = gameState.players.reduce((s, p) => s + p.hand.length, 0) === 52;
        const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);
        if (isFirstTrick && !gameState.leadSuit && card.id !== '2-CLUBS') setMessage("Lead 2 of Clubs");
        else if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) setMessage(`Must follow ${gameState.leadSuit}`);
        else if (!gameState.leadSuit && card.suit === 'HEARTS' && !gameState.heartsBroken) setMessage("Hearts not broken");
        return;
      }
      playCard(0, card.id);
    }
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

  const SLOT_WIDTH = 88;
  const SLOT_HEIGHT = 119;
  const SLOT_GAP = 12;

  const getPassingDirectionLabel = () => {
    const directions = ["LEFT", "RIGHT", "ACROSS"];
    return directions[(gameState.roundNumber - 1) % 4] || "NONE";
  };

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden" onMouseMove={onDragMove} onTouchMove={onDragMove}>
      {/* HEADER */}
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <div className="flex gap-2">
          <button onClick={onExit} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">🏠</button>
          <button onClick={() => leaderboardService.openLeaderboard('HEARTS')} className="bg-white/10 rounded-xl px-2 h-10 flex items-center gap-1.5 shadow-lg border border-white/5 active:scale-95 transition-all">
            <span className="text-xl">🏆</span>
            <span className="text-[9px] font-black text-yellow-500 uppercase tracking-tighter">
              {currentRank ? `#${currentRank}` : 'RANK'}
            </span>
          </button>
          <button onClick={() => setShowHowToPlay(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">?</button>
        </div>
        <div className="text-center">
          <span className="text-[8px] text-white/40 font-black uppercase tracking-widest block leading-none mb-1">Round</span>
          <span className="text-3xl font-black italic text-yellow-500">{gameState.roundNumber}</span>
        </div>
        <button onClick={() => setShowHistory(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">📜</button>
      </div>

      <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-[100] w-full flex justify-center pointer-events-none px-6">
        {message && gameState.phase !== 'PASSING' && (
          <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-[11px] font-black uppercase shadow-2xl tracking-widest border-2 border-white/30 animate-deal pointer-events-auto">
            {message}
          </div>
        )}
      </div>

      <div className="h-[70%] relative w-full">
        {gameState.phase === 'PASSING' && (
          <div className="absolute inset-0 bg-black/75 z-[8] animate-fadeIn" />
        )}

        <Avatar player={gameState.players[2]} pos="top-6 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 2} isWinner={clearingTrick?.winnerId === 2} gameType="HEARTS" phase={gameState.phase} />
        <Avatar player={gameState.players[3]} pos="top-1/2 left-1 -translate-y-1/2" active={gameState.turnIndex === 3} isWinner={clearingTrick?.winnerId === 3} gameType="HEARTS" phase={gameState.phase} />
        <Avatar player={gameState.players[1]} pos="top-1/2 right-1 -translate-y-1/2" active={gameState.turnIndex === 1} isWinner={clearingTrick?.winnerId === 1} gameType="HEARTS" phase={gameState.phase} />
        <Avatar player={gameState.players[0]} pos="bottom-6 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 0} isWinner={clearingTrick?.winnerId === 0} gameType="HEARTS" phase={gameState.phase} />

        {gameState.phase === 'PASSING' && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] z-[20] w-[90%] max-w-sm flex flex-col items-center animate-fadeIn">
            <div className="bg-[#121212] border-2 border-[#d4af37] rounded-[3rem] p-8 shadow-[0_30px_60px_-12px_rgba(0,0,0,0.9)] w-full flex flex-col items-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
              
              <div className="mb-6 text-center relative z-10">
                <h3 className="text-[#d4af37] font-black uppercase text-[12px] tracking-[0.4em] mb-1">STRATEGIC PASS</h3>
                <div className="text-white text-3xl font-black italic tracking-tighter uppercase leading-none">TO {getPassingDirectionLabel()}</div>
              </div>

              <div className="flex items-center justify-center gap-4 mb-8 relative z-10" ref={passingDialogRef}>
                {[0, 1, 2].map(i => (
                  <div key={i} className="staged-slot rounded-xl flex items-center justify-center border-2 border-[#d4af37]/20 bg-black/40 overflow-hidden" style={{ width: `${SLOT_WIDTH}px`, height: `${SLOT_HEIGHT}px` }}>
                    <span className="text-white/5 font-black text-6xl">?</span>
                  </div>
                ))}
              </div>

              <div className="h-14 w-full relative z-10">
                {gameState.passingCards.length === 3 && (
                  <button onClick={handleConfirmPass} className="w-full h-full bg-green-600 hover:bg-green-500 rounded-2xl font-black text-lg text-white uppercase shadow-[0_8px_0_rgb(21,128,61)] active:shadow-none active:translate-y-2 transition-all pointer-events-auto">
                    Confirm Selection
                  </button>
                )}
                {gameState.passingCards.length < 3 && (
                  <div className="w-full h-full flex items-center justify-center text-[#d4af37]/40 text-[10px] font-black uppercase tracking-widest border border-[#d4af37]/20 rounded-2xl bg-black/30">
                    Choose {3 - gameState.passingCards.length} Cards
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TRICK AREA: Refined Symmetric Cross Formation */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18rem] h-[18rem] flex items-center justify-center pointer-events-none">
          {gameState.currentTrick.map((t, idx) => {
             const offsets = [
               { x: 0,   y: 45,  rot: '2deg' },   // P0 (Bottom)
               { x: 60,  y: 0,   rot: '5deg' },   // P1 (Right)
               { x: 0,   y: -45, rot: '-3deg' },  // P2 (Top)
               { x: -60, y: 0,   rot: '-6deg' }   // P3 (Left)
             ];
             const off = offsets[t.playerId];
             const winDir = [{ x: 0, y: 500 }, { x: 400, y: 0 }, { x: 0, y: -500 }, { x: -400, y: 0 }][clearingTrick?.winnerId ?? 0];
             const startPos = [
                { x: 0, y: 350 }, { x: 380, y: 0 }, { x: 0, y: -350 }, { x: -380, y: 0 }
             ][t.playerId];

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
      </div>

      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black via-black/40 to-transparent overflow-visible" ref={handContainerRef}>
        <div className="relative w-full flex-1">
           {handLayout.map((item, idx, arr) => {
             const { card, x: tx, isPlayable } = item;
             const centerIdx = (arr.length - 1) / 2;
             const diffFromCenter = idx - centerIdx;
             const rot = diffFromCenter * 1.5; 
             const ty = Math.pow(diffFromCenter, 2) * 0.4; 
             const isDragging = dragInfo?.id === card.id;
             const dragOffset = isDragging ? dragInfo.currentY - dragInfo.startY : 0;
             const passingIndex = gameState.passingCards.indexOf(card.id);
             const isSelectedForPass = passingIndex !== -1;
             
             let finalTx = tx;
             let finalTy = ty; 
             let finalRot = rot;
             let finalZIndex = 100 + idx;
             let finalScale = isDragging ? 1.15 : (isCardPlayable && gameState.phase === 'PLAYING' && gameState.turnIndex === 0 ? 1 : (gameState.phase === 'PLAYING' && gameState.turnIndex === 0 ? 0.95 : 1));

             if (isSelectedForPass && passingDialogRef.current && handContainerRef.current) {
                const dialogRect = passingDialogRef.current.getBoundingClientRect();
                const handRect = handContainerRef.current.getBoundingClientRect();
                const totalSlotsWidth = (3 * SLOT_WIDTH) + (2 * SLOT_GAP);
                const firstSlotLeft = dialogRect.left + (dialogRect.width - totalSlotsWidth) / 2;
                const targetX = firstSlotLeft + (passingIndex * (SLOT_WIDTH + SLOT_GAP));
                const targetY = dialogRect.top + (dialogRect.height - SLOT_HEIGHT) / 2;
                finalTx = targetX - handRect.left;
                finalTy = targetY - handRect.top;
                finalRot = 0;
                finalZIndex = 500;
                finalScale = 1.0; 
             }

             const isDimmed = gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && !isPlayable;
             return (
                <div key={card.id} onMouseDown={(e) => onDragStart(e, card.id)} onTouchStart={(e) => onDragStart(e, card.id)} onMouseUp={() => onDragEnd(card)} onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab ${isDragging || isSelectedForPass ? 'z-[600]' : ''}`}
                  style={{ 
                    transform: `translate3d(${finalTx}px, ${finalTy + dragOffset}px, 0) rotate(${finalRot}deg) scale(${finalScale})`, 
                    zIndex: isDragging ? 700 : finalZIndex, 
                    animationDelay: `${idx * 0.015}s`,
                    pointerEvents: gameState.phase === 'PASSING' || (gameState.phase === 'PLAYING' && gameState.turnIndex === 0) ? 'auto' : 'none'
                  }}
                >
                  <CardView 
                    card={card} 
                    size="lg" 
                    highlighted={isSelectedForPass || (isDragging && Math.abs(dragOffset) >= 50)} 
                    hint={hintCardId === card.id}
                    inactive={isDimmed}
                  />
                </div>
             );
           })}
        </div>
      </div>

      {showHistory && <HistoryModal history={gameState.trickHistory} players={gameState.players} onClose={() => setShowHistory(false)} />}
      {showHowToPlay && <HowToPlayModal gameType="HEARTS" onClose={() => setShowHowToPlay(false)} />}

      {(gameState.phase === 'ROUND_END' || gameState.phase === 'GAME_OVER') && (
        <Overlay title={gameState.phase === 'GAME_OVER' ? "FINAL SCORES" : "ROUND END"} subtitle="Standings Update">
            <div className="w-full space-y-4 mb-12">
               {gameState.players.map(p => (
                 <div key={p.id} className="flex justify-between items-center bg-white/5 p-4 rounded-3xl border border-white/10 shadow-inner">
                    <div className="flex items-center gap-4"><span className="text-4xl drop-shadow-lg">{p.avatar}</span><div className="flex flex-col items-start text-left"><span className="font-black text-sm uppercase tracking-tight">{p.name}</span><span className="text-[10px] text-white/30 font-bold uppercase tracking-tighter">Total Score: {p.score}</span></div></div>
                    <div className="text-right text-3xl font-black italic text-yellow-500 drop-shadow-md">+{p.currentRoundScore}</div>
                 </div>
               ))}
            </div>
            <button onClick={() => { if (gameState.phase === 'GAME_OVER') onExit(); else { setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1})); } }} 
              className="w-full py-6 bg-green-600 rounded-[2.5rem] font-black text-2xl uppercase shadow-2xl border-b-8 border-green-800 tracking-[0.1em]">CONTINUE</button>
        </Overlay>
      )}
    </div>
  );
}
