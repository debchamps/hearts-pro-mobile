
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState, Card, GamePhase, GameSettings, Player, HistoryItem } from './types';
import { createDeck, shuffle } from './constants';
import { getSpadesBid, getSpadesMove } from './services/spadesAi';
import { Avatar, CardView, Overlay, HistoryModal } from './SharedComponents';

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

export function SpadesGame({ initialPlayers, onExit, soundEnabled }: { initialPlayers: Player[], onExit: () => void, soundEnabled: boolean }) {
  const [gameState, setGameState] = useState<GameState>({
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
    settings: { targetScore: 500, shootTheMoon: false, noPassing: true, jackOfDiamonds: false },
    teamScores: [0, 0],
    teamBags: [0, 0],
    trickHistory: []
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
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
    if (diff > 60 || Math.abs(diff) < 10) {
      handleHumanPlay(card);
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
        let winner = gameState.currentTrick[0];
        for (let i = 1; i < 4; i++) {
          const curr = gameState.currentTrick[i];
          if (curr.card.suit === winner.card.suit) { if (curr.card.value > winner.card.value) winner = curr; }
          else if (curr.card.suit === 'SPADES') { if (winner.card.suit !== 'SPADES' || curr.card.value > winner.card.value) winner = curr; }
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
            const newPlayers = prev.players.map(p => p.id === winner.playerId ? { ...p, tricksWon: (p.tricksWon || 0) + 1 } : p);
            const newHistory = [...prev.trickHistory, historyItem];

            if (newPlayers[0].hand.length === 0) {
              const team0Bid = newPlayers[0].bid! + newPlayers[2].bid!;
              const team1Bid = newPlayers[1].bid! + newPlayers[3].bid!;
              const team0Tricks = newPlayers[0].tricksWon! + newPlayers[2].tricksWon!;
              const team1Tricks = newPlayers[1].tricksWon! + newPlayers[3].tricksWon!;
              let s0 = prev.teamScores[0], s1 = prev.teamScores[1], b0 = prev.teamBags[0], b1 = prev.teamBags[1];
              if (team0Tricks >= team0Bid) { s0 += team0Bid * 10 + (team0Tricks - team0Bid); b0 += (team0Tricks - team0Bid); } else s0 -= team0Bid * 10;
              if (team1Tricks >= team1Bid) { s1 += team1Bid * 10 + (team1Tricks - team1Bid); b1 += (team1Tricks - team1Bid); } else s1 -= team1Bid * 10;
              if (b0 >= 10) { s0 -= 100; b0 -= 10; } if (b1 >= 10) { s1 -= 100; b1 -= 10; }
              const over = s0 >= 500 || s1 >= 500;
              return { ...prev, players: newPlayers, teamScores: [s0, s1], teamBags: [b0, b1], phase: over ? 'GAME_OVER' : 'ROUND_END', currentTrick: [], leadSuit: null, dealerIndex: (prev.dealerIndex + 1) % 4, trickHistory: newHistory };
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winner.playerId, trickHistory: newHistory };
          });
          setClearingTrick(null);
        }, 850);
      }, 800);
    }
  }, [gameState.currentTrick, soundEnabled, gameState.leadSuit]);

  const handleHumanPlay = (card: Card) => {
    if (gameState.turnIndex !== 0 || isProcessing || gameState.phase !== 'PLAYING' || clearingTrick) return;
    const hand = gameState.players[0].hand;
    const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);
    if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) { setMessage(`Must follow ${gameState.leadSuit}`); return; }
    if (!gameState.leadSuit && card.suit === 'SPADES' && !gameState.spadesBroken && !hand.every(c => c.suit === 'SPADES')) { setMessage("Spades not broken"); return; }
    playCard(0, card.id);
    setMessage("");
  };

  // Fixed safe margin for the leftmost card
  const START_X_PADDING = 16;
  // Reduced card width (0.95x of original 5.8rem -> ~88px)
  const CARD_WIDTH = 88;

  const handSpacing = useMemo(() => {
    const count = gameState.players[0].hand.length;
    if (count <= 1) return 0;
    
    // Rule: Rightmost card can be 50% hidden.
    // Max width we can take is windowWidth + (CARD_WIDTH / 2) - START_X_PADDING
    const availableWidth = window.innerWidth + (CARD_WIDTH / 2) - (START_X_PADDING * 2);
    const idealSpacing = 40; // Looks good left-anchored
    
    // Ensure we don't exceed the 50% visibility rule on the right
    const maxSpacing = (availableWidth - CARD_WIDTH) / (count - 1);
    
    return Math.min(idealSpacing, maxSpacing);
  }, [gameState.players[0].hand.length]);

  const startX = START_X_PADDING;

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden" onMouseMove={onDragMove} onTouchMove={onDragMove}>
      {/* HEADER */}
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <button onClick={onExit} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">🏠</button>
        <div className="flex items-center bg-black/60 rounded-lg overflow-hidden border border-white/10 h-10 w-48 shadow-lg">
          <div className="flex-1 bg-blue-700 h-full flex flex-col items-center justify-center leading-none">
            <span className="text-[14px] font-black">{gameState.teamScores[0]}</span>
            <span className="text-[7px] font-black opacity-50">BLUE</span>
          </div>
          <div className="w-8 h-full bg-black/40 flex items-center justify-center text-[10px] font-black text-yellow-500 italic">500</div>
          <div className="flex-1 bg-rose-700 h-full flex flex-col items-center justify-center leading-none">
            <span className="text-[14px] font-black">{gameState.teamScores[1]}</span>
            <span className="text-[7px] font-black opacity-50">RED</span>
          </div>
        </div>
        <button onClick={() => setShowHistory(true)} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl">📜</button>
      </div>

      {/* PLAY AREA */}
      <div className="h-[70%] relative w-full">
        <Avatar player={gameState.players[2]} pos="top-6 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 2} isWinner={clearingTrick?.winnerId === 2} gameType="SPADES" phase={gameState.phase} />
        <Avatar player={gameState.players[3]} pos="top-1/2 left-4 -translate-y-1/2" active={gameState.turnIndex === 3} isWinner={clearingTrick?.winnerId === 3} gameType="SPADES" phase={gameState.phase} />
        <Avatar player={gameState.players[1]} pos="top-1/2 right-4 -translate-y-1/2" active={gameState.turnIndex === 1} isWinner={clearingTrick?.winnerId === 1} gameType="SPADES" phase={gameState.phase} />
        <Avatar player={gameState.players[0]} pos="bottom-6 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 0} isWinner={clearingTrick?.winnerId === 0} gameType="SPADES" phase={gameState.phase} />

        {gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && (
          <div className="absolute bottom-[20%] left-1/2 -translate-x-1/2 text-[12px] font-black uppercase tracking-[0.3em] text-yellow-400 drop-shadow-lg z-20 whitespace-nowrap">Your Turn</div>
        )}

        {/* Trick Area */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18rem] h-[18rem] flex items-center justify-center pointer-events-none">
          {gameState.currentTrick.map((t, idx) => {
             const spread = 45; 
             const offsets = [
               { x: 0, y: spread, rot: '0deg' }, { x: spread, y: 0, rot: '15deg' }, { x: 0, y: -spread, rot: '-5deg' }, { x: -spread, y: 0, rot: '-15deg' }
             ];
             const off = offsets[t.playerId];
             const winDir = [{ x: 0, y: 500 }, { x: 400, y: 0 }, { x: 0, y: -500 }, { x: -400, y: 0 }][clearingTrick?.winnerId ?? 0];
             
             const startPos = [
                { x: 0, y: 350 }, { x: 350, y: 0 }, { x: 0, y: -350 }, { x: -350, y: 0 }
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
           {gameState.phase === 'BIDDING' && gameState.turnIndex === 0 && (
             <div className="mt-8 grid grid-cols-5 gap-3 bg-black/80 p-5 rounded-[2.5rem] border border-white/10 backdrop-blur-2xl shadow-2xl">
               {[1,2,3,4,5,6,7,8,9,10,11,12,13].map(b => (
                 <button key={b} onClick={() => handleBid(b)} className="w-10 h-10 rounded-xl bg-white/5 hover:bg-yellow-500 hover:text-black font-black text-lg transition-all active:scale-90"> {b} </button>
               ))}
               <button onClick={() => handleBid(0)} className="col-span-2 h-10 rounded-xl bg-rose-500 font-black text-sm uppercase">NIL</button>
             </div>
           )}
        </div>
      </div>

      {/* HAND AREA */}
      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black/95 via-black/40 to-transparent overflow-visible">
        <div className="relative w-full flex-1">
           {gameState.players[0].hand.map((card, idx, arr) => {
             const tx = (idx * handSpacing) + startX;
             const centerIdx = (arr.length - 1) / 2;
             const diffFromCenter = idx - centerIdx;
             
             const rot = diffFromCenter * 2; 
             const ty = Math.pow(diffFromCenter, 2) * 0.8;
             
             const isDragging = dragInfo?.id === card.id;
             const dragOffset = isDragging ? dragInfo.currentY - dragInfo.startY : 0;
             let finalTx = tx;
             let finalTy = ty; 
             let finalRot = rot;
             let finalZIndex = 100 + idx;
             return (
                <div key={card.id} onMouseDown={(e) => onDragStart(e, card.id)} onTouchStart={(e) => onDragStart(e, card.id)} onMouseUp={() => onDragEnd(card)} onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab ${isDragging ? 'z-[500]' : ''}`}
                  style={{ transform: `translate3d(${finalTx}px, ${finalTy + dragOffset}px, 0) rotate(${finalRot}deg) scale(${isDragging ? 1.15 : 1})`, zIndex: isDragging ? 500 : finalZIndex, animationDelay: `${idx * 0.015}s` }}
                >
                  <CardView card={card} size="lg" highlighted={isDragging && Math.abs(dragOffset) >= 50} hint={hintCardId === card.id} />
                </div>
             );
           })}
        </div>
      </div>

      {showHistory && <HistoryModal history={gameState.trickHistory} players={gameState.players} onClose={() => setShowHistory(false)} />}

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
            <button onClick={() => { if (gameState.phase === 'GAME_OVER') onExit(); else { setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1})); } }} 
              className="w-full py-6 bg-green-600 rounded-[2.5rem] font-black text-2xl uppercase shadow-2xl border-b-8 border-green-800 tracking-[0.1em]">CONTINUE</button>
        </Overlay>
      )}
    </div>
  );
}
