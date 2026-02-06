import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GameState, Player, Card, GamePhase, Suit, ScreenState } from './types';
import { createDeck, shuffle, SUIT_SYMBOLS, SUIT_COLORS } from './constants';
import { getBestMove } from './services/geminiService';

const INITIAL_PLAYERS: Player[] = [
  { id: 0, name: 'YOU', avatar: '👤', hand: [], score: 0, currentRoundScore: 0, isHuman: true },
  { id: 1, name: 'FISH', avatar: '🐟', hand: [], score: 0, currentRoundScore: 0, isHuman: false },
  { id: 2, name: 'SNAKE', avatar: '🐍', hand: [], score: 0, currentRoundScore: 0, isHuman: false },
  { id: 3, name: 'SHRIMP', avatar: '🦐', hand: [], score: 0, currentRoundScore: 0, isHuman: false },
];

const TARGET_SCORE = 100;

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('MENU');
  const [gameState, setGameState] = useState<GameState>({
    players: INITIAL_PLAYERS,
    dealerIndex: 0,
    turnIndex: -1,
    leadSuit: null,
    currentTrick: [],
    heartsBroken: false,
    phase: 'DEALING',
    roundNumber: 1,
    passingCards: []
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);

  const startRound = useCallback(() => {
    const deck = shuffle(createDeck());
    const players = gameState.players.map((p, i) => ({
      ...p,
      hand: deck.slice(i * 13, (i + 1) * 13).sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return b.value - a.value;
      }),
      currentRoundScore: 0,
    }));

    const cycle = (gameState.roundNumber - 1) % 4;
    const isPassingRound = cycle !== 3;

    setGameState(prev => ({
      ...prev,
      players,
      phase: isPassingRound ? 'PASSING' : 'PLAYING',
      turnIndex: -1,
      currentTrick: [],
      leadSuit: null,
      heartsBroken: false,
      passingCards: []
    }));

    if (!isPassingRound) {
       let starter = 0;
       players.forEach((p, i) => { if (p.hand.find(c => c.id === '2-CLUBS')) starter = i; });
       setGameState(prev => ({ ...prev, turnIndex: starter }));
       setMessage("Round 4: No Pass. 2 of Clubs leads.");
    } else {
       const dir = cycle === 0 ? "Left" : cycle === 1 ? "Right" : "Across";
       setMessage(`Pass 3 cards ${dir}`);
    }
  }, [gameState.players, gameState.roundNumber]);

  useEffect(() => {
    if (gameState.phase === 'DEALING' && screen === 'GAME') {
      const timer = setTimeout(startRound, 600);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, startRound, screen]);

  const playCard = useCallback((playerId: number, cardId: string) => {
    setGameState(prev => {
      const player = prev.players[playerId];
      const card = player.hand.find(c => c.id === cardId)!;
      const newHand = player.hand.filter(c => c.id !== cardId);
      const newPlayers = prev.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p);
      const newTrick = [...prev.currentTrick, { playerId, card }];
      let newLeadSuit = prev.currentTrick.length === 0 ? card.suit : prev.leadSuit;
      let newHeartsBroken = prev.heartsBroken || card.suit === 'HEARTS';

      return {
        ...prev,
        players: newPlayers,
        currentTrick: newTrick,
        leadSuit: newLeadSuit,
        heartsBroken: newHeartsBroken,
        turnIndex: (prev.turnIndex + 1) % 4,
      };
    });
  }, []);

  const handlePass = () => {
    if (gameState.passingCards.length !== 3) return;
    const cycle = (gameState.roundNumber - 1) % 4;
    const shift = cycle === 0 ? 1 : cycle === 1 ? 3 : 2;

    setGameState(prev => {
      const passedCardsByPlayer: Record<number, Card[]> = {};
      prev.players.forEach(p => {
        if (p.isHuman) {
          passedCardsByPlayer[p.id] = p.hand.filter(c => prev.passingCards.includes(c.id));
        } else {
          const sorted = [...p.hand].sort((a, b) => {
             const weight = (c: Card) => (c.id === 'Q-SPADES' ? 1000 : c.suit === 'HEARTS' ? 100 + c.value : c.value);
             return weight(b) - weight(a);
          });
          passedCardsByPlayer[p.id] = sorted.slice(0, 3);
        }
      });

      const newPlayers = prev.players.map(p => {
        const sourcePlayerId = (p.id - shift + 4) % 4;
        const receivingCards = passedCardsByPlayer[sourcePlayerId];
        const removedCards = passedCardsByPlayer[p.id];
        const remainingHand = p.hand.filter(c => !removedCards.some(rc => rc.id === c.id));
        const updatedHand = [...remainingHand, ...receivingCards].sort((a, b) => {
           if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
           return b.value - a.value;
        });
        return { ...p, hand: updatedHand };
      });

      let starter = 0;
      newPlayers.forEach((p, i) => { if (p.hand.find(c => c.id === '2-CLUBS')) starter = i; });
      return { ...prev, players: newPlayers, phase: 'PLAYING', turnIndex: starter, passingCards: [] };
    });
    setMessage("");
  };

  const togglePassingCard = useCallback((cardId: string) => {
    setGameState(prev => {
      if (prev.phase !== 'PASSING') return prev;
      const isSelected = prev.passingCards.includes(cardId);
      if (isSelected) {
        return { ...prev, passingCards: prev.passingCards.filter(id => id !== cardId) };
      } else {
        if (prev.passingCards.length >= 3) return prev;
        return { ...prev, passingCards: [...prev.passingCards, cardId] };
      }
    });
  }, []);

  useEffect(() => {
    const activePlayer = gameState.players[gameState.turnIndex];
    if (gameState.phase === 'PLAYING' && activePlayer && !activePlayer.isHuman && !isProcessing && screen === 'GAME' && !clearingTrick) {
      const runAi = async () => {
        setIsProcessing(true);
        const isFirstTrick = gameState.players.reduce((sum, p) => sum + p.hand.length, 0) === 52;
        const cardId = await getBestMove(activePlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.heartsBroken, isFirstTrick, activePlayer.name);
        playCard(gameState.turnIndex, cardId);
        setIsProcessing(false);
      };
      runAi();
    }
  }, [gameState.turnIndex, gameState.phase, screen, isProcessing, clearingTrick]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) {
      const timer = setTimeout(() => {
        const leadSuit = gameState.currentTrick[0].card.suit;
        const winner = gameState.currentTrick.reduce((w, c) => (c.card.suit === leadSuit && c.card.value > w.card.value ? c : w), gameState.currentTrick[0]);
        setClearingTrick({ winnerId: winner.playerId });

        setTimeout(() => {
          setGameState(prev => {
            const points = prev.currentTrick.reduce((s, t) => s + t.card.points, 0);
            const newPlayers = prev.players.map(p => p.id === winner.playerId ? { ...p, currentRoundScore: p.currentRoundScore + points } : p);
            
            if (newPlayers[0].hand.length === 0) {
              let moonShooterId = -1;
              newPlayers.forEach(p => { if (p.currentRoundScore === 26) moonShooterId = p.id; });
              const finalPlayers = newPlayers.map(p => {
                 let added = p.currentRoundScore;
                 if (moonShooterId !== -1) added = (p.id === moonShooterId) ? 0 : 26;
                 return { ...p, score: p.score + added, currentRoundScore: 0 };
              });
              const anyGameOver = finalPlayers.some(p => p.score >= TARGET_SCORE);
              return { ...prev, players: finalPlayers, phase: anyGameOver ? 'GAME_OVER' : 'ROUND_END' };
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winner.playerId };
          });
          setClearingTrick(null);
        }, 800);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gameState.currentTrick]);

  const handleHumanPlay = (card: Card) => {
    if (gameState.turnIndex !== 0 || isProcessing || gameState.phase !== 'PLAYING' || clearingTrick) return;
    const isFirstTrick = gameState.players.reduce((sum, p) => sum + p.hand.length, 0) === 52;
    const hasLeadSuit = gameState.players[0].hand.some(c => c.suit === gameState.leadSuit);

    if (isFirstTrick && !gameState.leadSuit && card.id !== '2-CLUBS') { setMessage("Lead with 2 of Clubs"); return; }
    if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) { setMessage(`Must follow ${gameState.leadSuit}`); return; }
    if (isFirstTrick && (card.suit === 'HEARTS' || card.id === 'Q-SPADES')) {
       if (!gameState.players[0].hand.every(c => c.suit === 'HEARTS' || c.id === 'Q-SPADES')) {
          setMessage("No points on first trick"); return;
       }
    }
    if (!gameState.leadSuit && card.suit === 'HEARTS' && !gameState.heartsBroken) {
      if (!gameState.players[0].hand.every(c => c.suit === 'HEARTS')) { setMessage("Hearts not broken yet"); return; }
    }
    playCard(0, card.id);
    setMessage("");
  };

  const handSpacing = useMemo(() => {
    const count = gameState.players[0].hand.length;
    const availableWidth = window.innerWidth - 60;
    return Math.min(26, availableWidth / Math.max(1, count - 1));
  }, [gameState.players[0].hand.length]);

  if (screen === 'MENU') {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center felt-bg overflow-hidden">
        <div className="text-9xl mb-4 drop-shadow-2xl animate-bounce">♥️</div>
        <h1 className="text-8xl font-black text-yellow-500 italic mb-2 tracking-tighter drop-shadow-lg">HEARTS</h1>
        <p className="text-white/40 text-[11px] tracking-[0.5em] font-bold mb-16 uppercase">Professional Offline Edition</p>
        <button 
          onClick={() => { setGameState(p => ({...p, players: INITIAL_PLAYERS.map(pl => ({...pl, score: 0})), roundNumber: 1, phase: 'DEALING'})); setScreen('GAME'); }}
          className="px-20 py-7 bg-green-600 rounded-[2.5rem] text-3xl font-black shadow-2xl active:scale-95 transition-transform border-b-8 border-green-800"
        >
          START GAME
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col felt-bg select-none relative overflow-hidden">
      {/* Header HUD */}
      <div className="flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/20 pb-4 backdrop-blur-md border-b border-white/5">
        <button onClick={() => setScreen('MENU')} className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg active:scale-90 transition-transform">⚙️</button>
        <div className="text-center">
            <span className="text-[10px] text-white/50 font-black uppercase tracking-widest block mb-0.5 leading-none">Round</span>
            <span className="text-4xl font-black italic text-yellow-500 drop-shadow-md leading-none">{gameState.roundNumber}</span>
        </div>
        <div className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg">📊</div>
      </div>

      <div className="flex-1 relative flex flex-col pt-16">
        {/* Avatars Cross Layout */}
        <Avatar player={gameState.players[2]} pos="top-4 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 2} />
        <Avatar player={gameState.players[3]} pos="top-1/2 left-6 -translate-y-1/2" active={gameState.turnIndex === 3} />
        <Avatar player={gameState.players[1]} pos="top-1/2 right-6 -translate-y-1/2" active={gameState.turnIndex === 1} />

        {/* Center Trick Pot Area */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[22rem] h-[22rem] flex items-center justify-center z-20">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
              <span className="text-[20rem] text-white">♥</span>
          </div>

          {gameState.phase !== 'PASSING' && gameState.currentTrick.map((t, playIdx) => {
             // Card placement in center (spread out to be visible)
             const spread = 95;
             const offsets = [
               { x: 0, y: spread, start: 'translateY(400px)', rot: '-4deg' },    // YOU
               { x: spread, y: 0, start: 'translateX(300px)', rot: '12deg' },   // FISH
               { x: 0, y: -spread, start: 'translateY(-400px)', rot: '6deg' },  // SNAKE
               { x: -spread, y: 0, start: 'translateX(-300px)', rot: '-14deg' } // SHRIMP
             ];
             const off = offsets[t.playerId];
             
             // Where cards fly to when trick ends
             // Targets based on avatar positions
             const winPositions = [
                { x: 0, y: 350 },  // YOU (Bottom)
                { x: 180, y: 0 },  // FISH (Right)
                { x: 0, y: -350 }, // SNAKE (Top)
                { x: -180, y: 0 }  // SHRIMP (Left)
             ];
             const winDir = winPositions[clearingTrick?.winnerId ?? 0];

             return (
               <div key={t.card.id} 
                    className={`absolute transition-all animate-play ${clearingTrick ? 'animate-clear' : ''}`}
                    style={{ 
                      '--play-x': `${off.x}px`,
                      '--play-y': `${off.y}px`,
                      '--play-rot': off.rot,
                      '--play-start': off.start,
                      '--clear-x': `${winDir.x}px`,
                      '--clear-y': `${winDir.y}px`,
                      zIndex: 10 + playIdx
                    } as any}>
                 <CardView card={t.card} size="md" />
               </div>
             );
          })}
        </div>

        {/* Passing UI */}
        {gameState.phase === 'PASSING' && (
          <div className="absolute top-[35%] left-1/2 -translate-x-1/2 flex flex-col items-center w-full z-40 px-6">
             <div className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30 mb-5">Selected to Pass</div>
             <div className="flex gap-4">
                {[0,1,2].map(i => {
                  const cardId = gameState.passingCards[i];
                  const card = gameState.players[0].hand.find(c => c.id === cardId);
                  return (
                    <div key={i} className="w-18 h-26 rounded-2xl staged-slot flex items-center justify-center shadow-2xl relative transition-all duration-300">
                       {card ? <CardView card={card} size="sm" /> : <div className="text-white/5 text-5xl font-black">?</div>}
                    </div>
                  );
                })}
             </div>
             <button 
              onClick={handlePass}
              disabled={gameState.passingCards.length < 3}
              className={`mt-10 px-16 py-4 rounded-full font-black text-2xl shadow-[0_15px_30px_rgba(0,0,0,0.5)] transition-all duration-300 ${gameState.passingCards.length === 3 ? 'bg-blue-600 border-b-4 border-blue-800 scale-100 active:scale-95' : 'bg-gray-800/80 opacity-40 scale-90 grayscale'}`}
            >
              Confirm Selection
            </button>
          </div>
        )}

        {/* Alerts Banner */}
        <div className="absolute top-[22%] w-full flex flex-col items-center pointer-events-none z-50 px-10 text-center">
           {message && (
             <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-xs font-black uppercase shadow-2xl border-2 border-white/20 animate-fan leading-tight">
                {message}
             </div>
           )}
        </div>
      </div>

      {/* Player Hand */}
      <div className="relative h-48 w-full flex justify-center items-end px-4 pb-[calc(1rem+var(--safe-bottom))] z-40 bg-gradient-to-t from-black/30 to-transparent">
        <div className="relative flex justify-center items-end h-full w-full max-w-2xl">
           {gameState.players[0].hand.map((card, idx, arr) => {
             const count = arr.length;
             const mid = (count - 1) / 2;
             const diff = idx - mid;
             
             const tx = diff * handSpacing;
             const ty = Math.abs(diff) * 1.8;
             const rot = diff * 1.2;
             const isSel = gameState.passingCards.includes(card.id);

             return (
                <button 
                  key={card.id}
                  onClick={() => gameState.phase === 'PASSING' ? togglePassingCard(card.id) : handleHumanPlay(card)}
                  className={`absolute card-fan-item animate-deal ${isSel ? '-translate-y-32 opacity-40 scale-75' : ''}`}
                  style={{ 
                    transform: `translateX(${tx}px) translateY(${ty}px) rotate(${rot}deg)`,
                    zIndex: 100 + idx,
                    animationDelay: `${idx * 0.03}s`
                  }}
                >
                  <CardView card={card} size="lg" />
                </button>
             );
           })}
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex justify-around items-center h-20 bg-black/95 backdrop-blur-2xl border-t border-white/5 pb-[var(--safe-bottom)] z-50">
        <NavItem icon="🃏" label="Games" />
        <NavItem icon="ℹ️" label="Info" />
        <NavItem icon="🎴" label="Play" active />
        <NavItem icon="💡" label="Hint" />
        <NavItem icon="🛡️" label="Tiers" />
      </div>

      {/* Result Overlays */}
      {gameState.phase === 'ROUND_END' && (
        <Overlay title="ROUND OVER" subtitle="Final Standings">
            <div className="w-full space-y-3 mb-10">
               {gameState.players.map(p => (
                 <div key={p.id} className="flex justify-between items-center bg-white/5 p-4 rounded-3xl border border-white/10 shadow-inner">
                    <div className="flex items-center gap-4">
                       <span className="text-4xl">{p.avatar}</span>
                       <div className="flex flex-col items-start text-left">
                          <span className={`font-black text-sm uppercase tracking-tight ${p.id === 0 ? 'text-yellow-400' : 'text-white'}`}>{p.name}</span>
                          <span className="text-[10px] text-white/30 font-bold tracking-[0.2em]">TOTAL: {p.score}</span>
                       </div>
                    </div>
                    <div className="text-right">
                       <div className="text-3xl font-black italic text-yellow-500">+{p.currentRoundScore}</div>
                    </div>
                 </div>
               ))}
            </div>
            <button 
              onClick={() => setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1}))} 
              className="w-full py-6 bg-green-600 rounded-[2.5rem] font-black text-2xl uppercase border-b-8 border-green-800 active:translate-y-2 transition-all shadow-xl"
            >
              NEXT ROUND
            </button>
        </Overlay>
      )}
    </div>
  );
}

function Avatar({ player, pos, active }: { player: Player, pos: string, active: boolean }) {
  return (
    <div className={`absolute ${pos} flex flex-col items-center transition-all duration-500 z-10 ${active ? 'scale-110 drop-shadow-[0_0_20px_rgba(250,204,21,0.4)]' : 'opacity-40 scale-90'}`}>
      <div className={`w-18 h-18 rounded-[1.4rem] flex items-center justify-center text-4xl shadow-2xl border-2 transition-all ${active ? 'bg-yellow-400 border-yellow-200' : 'bg-black/40 border-white/10'}`}>
        {player.avatar}
      </div>
      <div className={`px-3 py-1 rounded-full text-[9px] font-black mt-2 uppercase tracking-widest shadow-md ${active ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/50'}`}>
        {player.name}
      </div>
      <div className="text-xl font-black italic mt-1 drop-shadow-md text-white">{player.score + player.currentRoundScore}</div>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: string, label: string, active?: boolean }) {
  return (
    <div className={`flex flex-col items-center gap-1.5 transition-all duration-300 ${active ? 'text-yellow-500 scale-110 drop-shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'text-white/20'}`}>
      <span className="text-2xl">{icon}</span>
      <span className="text-[9px] font-black uppercase tracking-widest">{label}</span>
      {active && <div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1 shadow-[0_0_10px_yellow]" />}
    </div>
  );
}

function Overlay({ title, subtitle, children }: { title: string, subtitle: string, children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-10 text-center animate-play">
       <h2 className="text-7xl font-black text-yellow-500 italic mb-1 tracking-tighter drop-shadow-2xl">{title}</h2>
       <p className="text-white/30 text-[11px] font-black uppercase tracking-[0.5em] mb-12">{subtitle}</p>
       <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function CardView({ card, size = 'md' }: { card: Card, size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'w-16 h-24 p-2' : size === 'md' ? 'w-20 h-30 p-2.5' : 'w-22 h-34 p-3';
  const rankStyle = size === 'sm' ? 'text-sm' : size === 'md' ? 'text-base' : 'text-xl';
  const symStyle = size === 'sm' ? 'text-3xl' : size === 'md' ? 'text-4xl' : 'text-5xl';
  const cornerSymStyle = size === 'sm' ? 'text-[10px]' : size === 'md' ? 'text-xs' : 'text-sm';
  const hugeIconStyle = size === 'sm' ? 'text-5xl' : size === 'md' ? 'text-6xl' : 'text-7xl';
  
  return (
    <div className={`${dims} bg-white rounded-xl card-shadow flex flex-col items-center justify-between border-b-[6px] border-gray-300 ${SUIT_COLORS[card.suit]} relative overflow-hidden transition-all duration-300`}>
      <div className="w-full flex flex-col items-start leading-none gap-0.5 z-10">
          <div className={`font-black tracking-tighter ${rankStyle}`}>{card.rank}</div>
          <div className={`${cornerSymStyle}`}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      
      <div className={`${symStyle} leading-none drop-shadow-sm z-10`}>
          {SUIT_SYMBOLS[card.suit]}
      </div>
      
      <div className={`absolute -bottom-2 -right-2 opacity-[0.12] ${hugeIconStyle} leading-none pointer-events-none rotate-[-15deg]`}>
          {SUIT_SYMBOLS[card.suit]}
      </div>

      <div className="w-full h-1 z-10"></div>
    </div>
  );
}