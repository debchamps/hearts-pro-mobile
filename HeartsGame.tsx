
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState, Card, GamePhase, GameSettings, Player, Suit } from './types';
import { createDeck, shuffle } from './constants';
import { getBestMove } from './services/heartsAi';
import { Avatar, CardView, Overlay } from './SharedComponents';

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

export function HeartsGame({ initialPlayers, onExit, soundEnabled }: { initialPlayers: Player[], onExit: () => void, soundEnabled: boolean }) {
  const [gameState, setGameState] = useState<GameState>({
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
    teamBags: [0, 0]
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [hintCardId, setHintCardId] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{ id: string; startY: number; currentY: number } | null>(null);

  const onDragStart = (e: React.MouseEvent | React.TouchEvent, id: string) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    setDragInfo({ id, startY: clientY, currentY: clientY });
  };

  const onDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragInfo) return;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
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
        passingCards: [] 
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
        setTimeout(() => {
          setGameState(prev => {
            const trickPoints = prev.currentTrick.reduce((s, t) => s + t.card.points, 0);
            const newPlayers = prev.players.map(p => p.id === winner.playerId ? { ...p, currentRoundScore: p.currentRoundScore + trickPoints } : p);
            if (newPlayers[0].hand.length === 0) {
              let shooterId = -1;
              if (prev.settings.shootTheMoon) newPlayers.forEach(p => { if (p.currentRoundScore === 26) shooterId = p.id; });
              const finalPlayers = newPlayers.map(p => ({ ...p, score: p.score + (shooterId !== -1 ? (p.id === shooterId ? 0 : 26) : p.currentRoundScore), currentRoundScore: 0 }));
              const over = finalPlayers.some(p => p.score >= prev.settings.targetScore);
              return { ...prev, players: finalPlayers, phase: over ? 'GAME_OVER' : 'ROUND_END', currentTrick: [], leadSuit: null, dealerIndex: (prev.dealerIndex + 1) % 4 };
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winner.playerId };
          });
          setClearingTrick(null);
        }, 850);
      }, 800);
    }
  }, [gameState.currentTrick, soundEnabled]);

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
      const hand = gameState.players[0].hand;
      const isFirstTrick = gameState.players.reduce((s,p)=>s+p.hand.length,0) === 52;
      const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);
      if (isFirstTrick && !gameState.leadSuit && card.id !== '2-CLUBS') { setMessage("Lead 2 of Clubs"); return; }
      if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) { setMessage(`Must follow ${gameState.leadSuit}`); return; }
      if (!gameState.leadSuit && card.suit === 'HEARTS' && !gameState.heartsBroken && !hand.every(c => c.suit === 'HEARTS')) { setMessage("Hearts not broken"); return; }
      playCard(0, card.id);
      setMessage("");
    }
  };

  const handSpacing = useMemo(() => {
    const count = gameState.players[0].hand.length;
    if (count <= 1) return 0;
    const containerWidth = Math.min(window.innerWidth, 550) - 80;
    const spacing = (containerWidth - 93) / (count - 1);
    return Math.max(28, Math.min(45, spacing));
  }, [gameState.players[0].hand.length]);

  const startX = useMemo(() => {
    const totalHandWidth = ((gameState.players[0].hand.length - 1) * handSpacing) + 93;
    // Offset nudged to +12px for better centering while ensuring left side doesn't clip
    return (window.innerWidth - totalHandWidth) / 2 + 12;
  }, [gameState.players[0].hand.length, handSpacing]);

  const SLOT_WIDTH = 93;
  const SLOT_HEIGHT = 125;
  const SLOT_GAP = 12;

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden" onMouseMove={onDragMove} onTouchMove={onDragMove}>
      {/* HEADER: 10% */}
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <button onClick={onExit} className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">🏠</button>
        <div className="text-center">
          <span className="text-[8px] text-white/40 font-black uppercase tracking-widest block leading-none mb-1">Round</span>
          <span className="text-3xl font-black italic text-yellow-500">{gameState.roundNumber}</span>
        </div>
        <div className="w-8" />
      </div>

      {/* PLAY AREA: 70% */}
      <div className="h-[70%] relative w-full">
        {/* Diamond formation */}
        <Avatar player={gameState.players[2]} pos="top-6 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 2} isWinner={clearingTrick?.winnerId === 2} gameType="HEARTS" phase={gameState.phase} />
        <Avatar player={gameState.players[3]} pos="top-1/2 left-1 -translate-y-1/2" active={gameState.turnIndex === 3} isWinner={clearingTrick?.winnerId === 3} gameType="HEARTS" phase={gameState.phase} />
        <Avatar player={gameState.players[1]} pos="top-1/2 right-1 -translate-y-1/2" active={gameState.turnIndex === 1} isWinner={clearingTrick?.winnerId === 1} gameType="HEARTS" phase={gameState.phase} />
        <Avatar player={gameState.players[0]} pos="bottom-6 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 0} isWinner={clearingTrick?.winnerId === 0} gameType="HEARTS" phase={gameState.phase} />

        {gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && (
          <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 text-[12px] font-black uppercase tracking-[0.3em] text-yellow-400 drop-shadow-lg z-20 whitespace-nowrap">Your Turn</div>
        )}

        {gameState.phase === 'PASSING' && (
          <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 flex items-center justify-center gap-[12px] z-[10] w-full">
            {[0, 1, 2].map(i => (
              <div key={i} className="staged-slot rounded-xl flex items-center justify-center" style={{ width: `${SLOT_WIDTH}px`, height: `${SLOT_HEIGHT}px` }}>
                <span className="text-white/10 font-black text-4xl">?</span>
              </div>
            ))}
          </div>
        )}

        {/* Trick Area */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18rem] h-[18rem] flex items-center justify-center pointer-events-none">
          {gameState.currentTrick.map((t, idx) => {
             const spread = 45; 
             const offsets = [
               { x: 0, y: spread, rot: '0deg' },    // You (P0)
               { x: spread, y: 0, rot: '15deg' },   // Fish (P1)
               { x: 0, y: -spread, rot: '-5deg' },  // Snake (P2)
               { x: -spread, y: 0, rot: '-15deg' }  // Shrimp (P3)
             ];
             const off = offsets[t.playerId];
             const winDir = [{ x: 0, y: 500 }, { x: 400, y: 0 }, { x: 0, y: -500 }, { x: -400, y: 0 }][clearingTrick?.winnerId ?? 0];
             
             const startPos = [
                { x: 0, y: 350 },    // P0: Bottom
                { x: 380, y: 0 },    // P1: Right
                { x: 0, y: -350 },   // P2: Top
                { x: -380, y: 0 }    // P3: Left
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

        <div className="absolute top-[20%] w-full flex flex-col items-center z-50 px-10 text-center">
           {message && <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-[11px] font-black uppercase shadow-2xl tracking-widest border-2 border-white/30">{message}</div>}
           {gameState.phase === 'PASSING' && gameState.passingCards.length === 3 && (
             <button onClick={handleConfirmPass} className="mt-6 px-10 py-4 bg-green-600 rounded-full font-black text-xl text-white uppercase shadow-2xl animate-bounce border-b-4 border-green-800">Confirm Pass</button>
           )}
        </div>
      </div>

      {/* HAND AREA: 20% - Subtle Arc Distribution */}
      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black/95 via-black/40 to-transparent overflow-visible">
        <div className="relative w-full flex-1">
           {gameState.players[0].hand.map((card, idx, arr) => {
             const tx = (idx * handSpacing) + startX;
             const centerIdx = (arr.length - 1) / 2;
             const diffFromCenter = idx - centerIdx;
             
             // Very subtle arc effect for better usability and visibility
             const rot = diffFromCenter * 1.2; 
             const ty = Math.pow(diffFromCenter, 2) * 0.45; 
             
             const isDragging = dragInfo?.id === card.id;
             const dragOffset = isDragging ? dragInfo.currentY - dragInfo.startY : 0;
             const passingIndex = gameState.passingCards.indexOf(card.id);
             const isSelectedForPass = passingIndex !== -1;

             let finalTx = tx;
             let finalTy = ty; 
             let finalRot = rot;
             let finalZIndex = 100 + idx;

             if (isSelectedForPass) {
                const centerOfScreen = window.innerWidth / 2;
                const slotX = centerOfScreen + (passingIndex - 1) * (SLOT_WIDTH + SLOT_GAP) - (SLOT_WIDTH / 2);
                finalTx = slotX - startX;
                finalTy = -200; 
                finalRot = 0;
                finalZIndex = 500;
             }

             return (
                <div key={card.id} onMouseDown={(e) => onDragStart(e, card.id)} onTouchStart={(e) => onDragStart(e, card.id)} onMouseUp={() => onDragEnd(card)} onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab ${isDragging || isSelectedForPass ? 'z-[500]' : ''}`}
                  style={{ transform: `translate3d(${finalTx}px, ${finalTy + dragOffset}px, 0) rotate(${finalRot}deg) scale(${isDragging ? 1.15 : (isSelectedForPass ? 1.0 : 1)})`, zIndex: isDragging ? 600 : finalZIndex, animationDelay: `${idx * 0.015}s` }}
                >
                  <CardView card={card} size="lg" highlighted={isSelectedForPass || (isDragging && Math.abs(dragOffset) >= 50)} hint={hintCardId === card.id} />
                  {isSelectedForPass && (
                     <div className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-500 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-black shadow-lg animate-bounce">
                        {passingIndex + 1}
                     </div>
                  )}
                </div>
             );
           })}
        </div>
      </div>

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
