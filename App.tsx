import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { GameState, Player, Card, GamePhase, Suit, ScreenState, GameSettings } from './types';
import { createDeck, shuffle, SUIT_SYMBOLS, SUIT_COLORS } from './constants';
import { getBestMove } from './services/geminiService';

const DEFAULT_SETTINGS: GameSettings = {
  shootTheMoon: true,
  noPassing: false,
  jackOfDiamonds: false,
};

const INITIAL_PLAYERS: Player[] = [
  { id: 0, name: 'YOU', avatar: '👤', hand: [], score: 0, currentRoundScore: 0, isHuman: true },
  { id: 1, name: 'FISH', avatar: '🐟', hand: [], score: 0, currentRoundScore: 0, isHuman: false },
  { id: 2, name: 'SNAKE', avatar: '🐍', hand: [], score: 0, currentRoundScore: 0, isHuman: false },
  { id: 3, name: 'SHRIMP', avatar: '🦐', hand: [], score: 0, currentRoundScore: 0, isHuman: false },
];

const TARGET_SCORE = 100;
const DRAG_THRESHOLD = 70;

const SOUNDS = {
  PLAY: 'https://cdn.pixabay.com/audio/2022/03/10/audio_f53093282f.mp3',
  CLEAR: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c3523e4291.mp3',
  SCORE: 'https://cdn.pixabay.com/audio/2021/08/04/audio_0625615d9a.mp3',
};

const playSound = (url: string, volume = 0.4) => {
  try {
    const audio = new Audio(url);
    audio.volume = volume;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {});
    }
  } catch (e) {}
};

interface GameDescriptor {
  id: string;
  name: string;
  icon: string;
  available: boolean;
  color: string;
}

const GAMES_LIST: GameDescriptor[] = [
  { id: 'hearts', name: 'Hearts', icon: '♥️', available: true, color: 'bg-red-500' },
  { id: 'callbreak', name: 'Callbreak', icon: '👑', available: false, color: 'bg-purple-600' },
  { id: 'spades', name: 'Spades', icon: '♠️', available: false, color: 'bg-indigo-600' },
  { id: 'bray', name: 'Bray', icon: '🃏', available: false, color: 'bg-amber-600' },
  { id: '29', name: '29', icon: '🎴', available: false, color: 'bg-emerald-600' },
  { id: 'bridge', name: 'Bridge', icon: '🌉', available: false, color: 'bg-cyan-600' },
];

// --- Sub-components ---

const Overlay = memo(({ title, subtitle, children, fullWidth = false }: { title: string, subtitle: string, children?: React.ReactNode, fullWidth?: boolean }) => {
  return (
    <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 text-center animate-play">
       <h2 className="text-5xl font-black text-yellow-500 italic mb-1 tracking-tighter drop-shadow-2xl uppercase">{title}</h2>
       <p className="text-white/30 text-[9px] font-black uppercase tracking-[0.5em] mb-8">{subtitle}</p>
       <div className={`w-full ${fullWidth ? 'max-w-xl' : 'max-w-sm'}`}>{children}</div>
    </div>
  );
});

const Avatar = memo(({ player, pos, active, isWinner = false }: { player: Player, pos: string, active: boolean, isWinner?: boolean }) => {
  if (!player) return null;
  return (
    <div className={`absolute ${pos} flex flex-col items-center transition-all duration-500 z-10 ${active ? 'opacity-100 scale-110' : 'opacity-60 scale-95'} ${isWinner ? 'scale-125' : ''}`}>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-3xl shadow-[0_10px_30px_rgba(0,0,0,0.7)] border transition-all duration-500 ${isWinner ? 'winner-glow bg-yellow-400 border-yellow-200' : 'bg-black/70 border-white/20'} ${active ? 'border-yellow-500 ring-2 ring-yellow-500/30' : ''}`}>{player.avatar}</div>
      <div className="flex flex-col items-center mt-1">
          <div className="text-xl font-black text-yellow-400 tabular-nums drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] tracking-tight leading-none">
            {player.score + (player.currentRoundScore || 0)}
          </div>
      </div>
    </div>
  );
});

const CardView = memo(({ card, size = 'md', inactive = false, highlighted = false, hint = false }: { card: Card, size?: 'sm' | 'md' | 'lg', inactive?: boolean, highlighted?: boolean, hint?: boolean }) => {
  if (!card) return null;
  const dims = size === 'sm' ? 'w-[4rem] h-[5.33rem] p-1.5' : size === 'md' ? 'w-[5rem] h-[6.66rem] p-2' : 'w-[6.2rem] h-[8.2rem] p-2.5';
  const rankStyle = size === 'sm' ? 'text-sm' : size === 'md' ? 'text-lg' : 'text-xl';
  const cornerSymStyle = size === 'sm' ? 'text-[8px]' : size === 'md' ? 'text-[10px]' : 'text-xs';
  const brSymStyle = size === 'sm' ? 'text-lg' : size === 'md' ? 'text-xl' : 'text-2xl';
  const hugeIconStyle = size === 'sm' ? 'text-5xl' : size === 'md' ? 'text-6xl' : 'text-7xl';
  
  const showRing = highlighted || hint;
  const ringColor = hint ? 'ring-cyan-400 shadow-[0_0_35px_rgba(34,211,238,0.9)]' : 'ring-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.6)]';

  return (
    <div className={`${dims} bg-white rounded-xl card-shadow flex flex-col items-start justify-start ${inactive ? '' : 'border-b-[5px]'} border-gray-300 ${SUIT_COLORS[card.suit] || 'text-black'} relative overflow-hidden transition-all duration-300 ${showRing ? `ring-4 ${ringColor}` : ''} ${hint ? 'animate-pulse' : ''}`}>
      <div className="flex flex-col items-start leading-none z-10"><div className={`font-black tracking-tighter ${rankStyle}`}>{card.rank}</div><div className={`${cornerSymStyle} mt-0.5`}>{SUIT_SYMBOLS[card.suit]}</div></div>
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.06] ${hugeIconStyle} leading-none pointer-events-none rotate-[-8deg]`}>{SUIT_SYMBOLS[card.suit]}</div>
      <div className={`absolute bottom-1 right-1 leading-none z-10 ${brSymStyle} pointer-events-none`}>{SUIT_SYMBOLS[card.suit]}</div>
      {inactive && <div className="absolute inset-0 bg-black/10 backdrop-blur-[0.5px]" />}
    </div>
  );
});

// --- Main App ---

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('HOME');
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const [settings, setSettings] = useState<GameSettings>(() => {
    const saved = localStorage.getItem('hearts_pro_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  const [gameState, setGameState] = useState<GameState>({
    players: INITIAL_PLAYERS,
    dealerIndex: 0,
    turnIndex: -1,
    leadSuit: null,
    currentTrick: [],
    heartsBroken: false,
    phase: 'DEALING',
    roundNumber: 1,
    passingCards: [],
    settings: settings
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [hintCardId, setHintCardId] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{ id: string; startY: number; currentY: number } | null>(null);

  useEffect(() => {
    localStorage.setItem('hearts_pro_settings', JSON.stringify(settings));
    setGameState(prev => ({ ...prev, settings }));
  }, [settings]);

  const startRound = useCallback(() => {
    const deck = shuffle(createDeck(settings));
    const players = gameState.players.map((p, i) => ({
      ...p,
      hand: deck.slice(i * 13, (i + 1) * 13).sort((a, b) => {
        if (!a || !b) return 0;
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return b.value - a.value;
      }),
      currentRoundScore: 0,
    }));

    const cycle = (gameState.roundNumber - 1) % 4;
    const isPassingRound = !settings.noPassing && cycle !== 3;

    setGameState(prev => {
      let turnIdx = -1;
      if (!isPassingRound) {
         players.forEach((p, i) => { if (p.hand.some(c => c && c.id === '2-CLUBS')) turnIdx = i; });
      }

      return {
        ...prev,
        players,
        phase: isPassingRound ? 'PASSING' : 'PLAYING',
        turnIndex: turnIdx,
        currentTrick: [],
        leadSuit: null,
        heartsBroken: false,
        passingCards: []
      };
    });

    setHintCardId(null);
    if (!isPassingRound) {
       const msg = settings.noPassing ? "Standard Game Mode" : "Round 4: No Pass. 2 of Clubs leads.";
       setMessage(msg);
    } else {
       const dir = cycle === 0 ? "Left" : cycle === 1 ? "Right" : "Across";
       setMessage(`Pass 3 cards ${dir}`);
    }
  }, [gameState.players, gameState.roundNumber, settings]);

  useEffect(() => {
    if (gameState.phase === 'DEALING' && screen === 'GAME') {
      const timer = setTimeout(startRound, 600);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, startRound, screen]);

  useEffect(() => {
    if (soundEnabled && (gameState.phase === 'ROUND_END' || gameState.phase === 'GAME_OVER')) {
      playSound(SOUNDS.SCORE, 0.5);
    }
  }, [gameState.phase, soundEnabled]);

  const playCard = useCallback((playerId: number, cardId: string) => {
    if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
    
    setGameState(prev => {
      if (prev.currentTrick.length >= 4) return prev;
      const player = prev.players[playerId];
      if (!player) return prev;
      const card = player.hand.find(c => c && c.id === cardId);
      if (!card) return prev;

      const newHand = player.hand.filter(c => c && c.id !== cardId);
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
    setHintCardId(null);
  }, [soundEnabled]);

  const handlePass = () => {
    if (gameState.passingCards.length !== 3) return;
    const cycle = (gameState.roundNumber - 1) % 4;
    const shift = cycle === 0 ? 1 : cycle === 1 ? 3 : 2;

    setGameState(prev => {
      const passedCardsByPlayer: Record<number, Card[]> = {};
      prev.players.forEach(p => {
        if (p.isHuman) {
          passedCardsByPlayer[p.id] = p.hand.filter(c => c && prev.passingCards.includes(c.id));
        } else {
          const sorted = [...p.hand].sort((a, b) => {
             if (!a || !b) return 0;
             const weight = (c: Card) => (c.id === 'Q-SPADES' ? 1000 : c.suit === 'HEARTS' ? 100 + c.value : c.value);
             return weight(b) - weight(a);
          });
          passedCardsByPlayer[p.id] = sorted.slice(0, 3);
        }
      });

      const newPlayers = prev.players.map(p => {
        const sourcePlayerId = (p.id - shift + 4) % 4;
        const receivingCards = passedCardsByPlayer[sourcePlayerId] || [];
        const removedCards = passedCardsByPlayer[p.id] || [];
        const remainingHand = p.hand.filter(c => c && !removedCards.some(rc => rc && rc.id === c.id));
        const updatedHand = [...remainingHand, ...receivingCards].sort((a, b) => {
           if (!a || !b) return 0;
           if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
           return b.value - a.value;
        });
        return { ...p, hand: updatedHand };
      });

      let starter = 0;
      newPlayers.forEach((p, i) => { 
        if (p.hand.some(c => c && c.id === '2-CLUBS')) starter = i; 
      });

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

  const handleHint = async () => {
    if (gameState.phase !== 'PLAYING' || gameState.turnIndex !== 0 || clearingTrick || isProcessing) return;
    setIsProcessing(true);
    try {
      const humanPlayer = gameState.players[0];
      const isFirstTrick = gameState.players.reduce((sum, p) => sum + (p.hand?.length || 0), 0) === 52;
      const bestCardId = await getBestMove(humanPlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.heartsBroken, isFirstTrick, humanPlayer.name, settings);
      setHintCardId(bestCardId);
      setTimeout(() => setHintCardId(null), 3000);
    } catch (e) {
      console.error("Hint failed", e);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    const activePlayer = gameState.players[gameState.turnIndex];
    if (
      gameState.phase === 'PLAYING' && 
      activePlayer && 
      !activePlayer.isHuman && 
      !isProcessing && 
      screen === 'GAME' && 
      !clearingTrick &&
      gameState.currentTrick.length < 4
    ) {
      const runAi = async () => {
        setIsProcessing(true);
        try {
          const isFirstTrick = gameState.players.reduce((sum, p) => sum + (p.hand?.length || 0), 0) === 52;
          const cardId = await getBestMove(activePlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.heartsBroken, isFirstTrick, activePlayer.name, settings);
          if (cardId) playCard(gameState.turnIndex, cardId);
        } catch (err) {
          console.error("AI Turn Error:", err);
        } finally {
          setIsProcessing(false);
        }
      };
      runAi();
    }
  }, [gameState.turnIndex, gameState.phase, screen, isProcessing, clearingTrick, playCard, gameState.currentTrick.length, settings]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) {
      const timer = setTimeout(() => {
        const firstCard = gameState.currentTrick[0];
        if (!firstCard || !firstCard.card) return;

        const leadSuit = firstCard.card.suit;
        const winner = gameState.currentTrick.reduce((w, c) => {
          if (!c.card || !w.card) return w;
          return (c.card.suit === leadSuit && c.card.value > w.card.value ? c : w);
        }, firstCard);
        
        setClearingTrick({ winnerId: winner.playerId });
        if (soundEnabled) playSound(SOUNDS.CLEAR, 0.4);

        setTimeout(() => {
          setGameState(prev => {
            const points = prev.currentTrick.reduce((s, t) => s + (t.card?.points || 0), 0);
            const newPlayers = prev.players.map(p => p.id === winner.playerId ? { ...p, currentRoundScore: p.currentRoundScore + points } : p);
            
            if (newPlayers[0].hand.length === 0) {
              let moonShooterId = -1;
              if (settings.shootTheMoon) {
                newPlayers.forEach(p => { if (p.currentRoundScore === 26) moonShooterId = p.id; });
              }

              const finalPlayers = newPlayers.map(p => {
                 let added = p.currentRoundScore || 0;
                 if (moonShooterId !== -1) added = (p.id === moonShooterId) ? 0 : 26;
                 return { ...p, score: (p.score || 0) + added, currentRoundScore: 0 };
              });
              const anyGameOver = finalPlayers.some(p => p.score >= TARGET_SCORE);
              return { 
                ...prev, 
                players: finalPlayers, 
                phase: anyGameOver ? 'GAME_OVER' : 'ROUND_END',
                currentTrick: [],
                leadSuit: null
              };
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winner.playerId };
          });
          setClearingTrick(null);
        }, 850);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [gameState.currentTrick, soundEnabled, settings.shootTheMoon]);

  const handleHumanPlay = (card: Card) => {
    if (gameState.turnIndex !== 0 || isProcessing || gameState.phase !== 'PLAYING' || clearingTrick || gameState.currentTrick.length >= 4) return;
    const isFirstTrick = gameState.players.reduce((sum, p) => sum + (p.hand?.length || 0), 0) === 52;
    const hasLeadSuit = gameState.players[0].hand.some(c => c && c.suit === gameState.leadSuit);

    if (isFirstTrick && !gameState.leadSuit && card.id !== '2-CLUBS') { setMessage("Lead with 2 of Clubs"); return; }
    if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) { setMessage(`Must follow ${gameState.leadSuit}`); return; }
    if (isFirstTrick && (card.suit === 'HEARTS' || card.id === 'Q-SPADES')) {
       if (!gameState.players[0].hand.every(c => c && (c.suit === 'HEARTS' || c.id === 'Q-SPADES'))) {
          setMessage("No points on first trick"); return;
       }
    }
    if (!gameState.leadSuit && card.suit === 'HEARTS' && !gameState.heartsBroken) {
      if (!gameState.players[0].hand.every(c => c && c.suit === 'HEARTS')) { setMessage("Hearts not broken yet"); return; }
    }
    playCard(0, card.id);
    setMessage("");
  };

  const handSpacing = useMemo(() => {
    const count = gameState.players[0].hand.length;
    if (count <= 1) return 0;
    
    const leftMargin = 16;
    const cardWidthLg = 99.2; 
    const targetRightEdge = window.innerWidth + (cardWidthLg * 0.5); 
    
    const availableSpan = targetRightEdge - leftMargin - cardWidthLg;
    const spacing = availableSpan / (count - 1);
    
    return Math.max(16, Math.min(64, spacing));
  }, [gameState.players[0].hand.length]);

  const legalCardIds = useMemo(() => {
    if (gameState.phase !== 'PLAYING' || gameState.turnIndex !== 0) return null;
    const hand = gameState.players[0].hand;
    const isFirstTrick = gameState.players.reduce((sum, p) => sum + (p.hand?.length || 0), 0) === 52;
    const hasLeadSuit = hand.some(c => c && c.suit === gameState.leadSuit);
    const set = new Set<string>();
    
    hand.forEach(card => {
        if (!card) return;
        let isLegal = true;
        if (!gameState.leadSuit) {
            if (isFirstTrick) isLegal = card.id === '2-CLUBS';
            else if (card.suit === 'HEARTS' && !gameState.heartsBroken) {
                isLegal = hand.every(c => !c || c.suit === 'HEARTS');
            }
        } else {
            if (hasLeadSuit) isLegal = card.suit === gameState.leadSuit;
            else if (isFirstTrick) {
                const isPointCard = card.suit === 'HEARTS' || card.id === 'Q-SPADES';
                const onlyPoints = hand.every(c => !c || c.suit === 'HEARTS' || c.id === 'Q-SPADES');
                if (isPointCard && !onlyPoints) isLegal = false;
            }
        }
        if (isLegal) set.add(card.id);
    });
    return set;
  }, [gameState]);

  const onDragStart = (e: React.TouchEvent | React.MouseEvent, cardId: string) => {
    if (dragInfo) return; 
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragInfo({ id: cardId, startY: y, currentY: y });
  };

  const onDragMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!dragInfo) return;
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragInfo(prev => prev ? { ...prev, currentY: Math.min(prev.startY, y) } : null);
  };

  const onDragEnd = (card: Card) => {
    if (!dragInfo || dragInfo.id !== card.id) {
        setDragInfo(null);
        return;
    }
    const deltaY = dragInfo.startY - dragInfo.currentY;
    if (deltaY >= DRAG_THRESHOLD) {
       if (gameState.phase === 'PASSING') togglePassingCard(card.id);
       else handleHumanPlay(card);
    } else if (deltaY < 5) {
       if (gameState.phase === 'PASSING') togglePassingCard(card.id);
       else handleHumanPlay(card);
    }
    setDragInfo(null);
  };

  // --- Render Branches ---

  if (screen === 'HOME') {
    return (
      <div className="h-screen w-full flex flex-col felt-bg overflow-hidden relative">
        <div className="pt-[var(--safe-top)] px-6 pb-4">
           <h1 className="text-4xl font-black text-yellow-500 italic tracking-tighter drop-shadow-lg mb-0.5">CARD HUB</h1>
           <p className="text-white/40 text-[9px] font-black uppercase tracking-[0.4em]">Professional Offline Suite</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-24 grid grid-cols-2 gap-4 content-start pt-4">
           {GAMES_LIST.map(game => (
             <div 
               key={game.id}
               onClick={() => {
                  if (game.available) {
                    if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
                    setGameState(p => ({
                      ...p, 
                      players: INITIAL_PLAYERS.map(pl => ({...pl, score: 0})), 
                      roundNumber: 1, 
                      phase: 'DEALING'
                    }));
                    setScreen('GAME');
                  }
               }}
               className={`relative aspect-[4/5] rounded-[2rem] p-5 flex flex-col items-center justify-between border-2 transition-all duration-300 ${game.available ? 'bg-black/40 border-white/10 active:scale-95 shadow-2xl cursor-pointer hover:border-white/20' : 'bg-black/60 border-white/5 opacity-50 grayscale cursor-not-allowed'}`}
             >
                <div className={`w-14 h-14 ${game.color} rounded-2xl flex items-center justify-center text-3xl shadow-lg border border-white/20 transform rotate-[-5deg]`}>
                   {game.icon}
                </div>
                <div className="flex flex-col items-center">
                   <span className="text-lg font-black uppercase tracking-tight text-white mb-1">{game.name}</span>
                   {!game.available && <span className="text-[8px] font-black uppercase tracking-widest text-yellow-500/80">Coming Soon</span>}
                   {game.available && <span className="text-[8px] font-black uppercase tracking-widest text-green-500">Play Now</span>}
                </div>
                {game.available && <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_green] animate-pulse" />}
             </div>
           ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 h-20 bg-black/90 backdrop-blur-3xl border-t border-white/5 flex justify-around items-center px-4 pb-[var(--safe-bottom)] shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
            <button className="flex flex-col items-center gap-1 text-yellow-500 scale-110">
              <span className="text-2xl">🏠</span>
              <span className="text-[9px] font-black uppercase tracking-widest">Home</span>
            </button>
            <button className="flex flex-col items-center gap-1 text-white/20">
              <span className="text-2xl">🏆</span>
              <span className="text-[9px] font-black uppercase tracking-widest">Leaders</span>
            </button>
            <button className="flex flex-col items-center gap-1 text-white/20">
              <span className="text-2xl">🤝</span>
              <span className="text-[9px] font-black uppercase tracking-widest">Social</span>
            </button>
            <button onClick={() => setScreen('SETTINGS')} className="flex flex-col items-center gap-1 text-white/20">
              <span className="text-2xl">⚙️</span>
              <span className="text-[9px] font-black uppercase tracking-widest">Config</span>
            </button>
        </div>
      </div>
    );
  }

  if (screen === 'SETTINGS') {
    return (
      <Overlay title="SETTINGS" subtitle="Configure Rules" fullWidth>
        <div className="space-y-4 mb-12">
          <SettingToggle 
            label="Shoot the Moon" 
            desc="Collect all hearts + Q of Spades to get 0 pts and give others 26."
            active={settings.shootTheMoon}
            onClick={() => setSettings(s => ({ ...s, shootTheMoon: !s.shootTheMoon }))}
          />
          <SettingToggle 
            label="No Passing Mode" 
            desc="Skip the card passing phase for all rounds."
            active={settings.noPassing}
            onClick={() => setSettings(s => ({ ...s, noPassing: !s.noPassing }))}
          />
          <SettingToggle 
            label="Jack of Diamonds" 
            desc="Jack of Diamonds is worth -10 points."
            active={settings.jackOfDiamonds}
            onClick={() => setSettings(s => ({ ...s, jackOfDiamonds: !s.jackOfDiamonds }))}
          />
        </div>
        <button 
          onClick={() => setScreen('HOME')}
          className="w-full py-6 bg-yellow-500 text-black rounded-[2.5rem] font-black text-2xl uppercase border-b-8 border-yellow-700 active:translate-y-2 transition-all shadow-xl"
        >
          BACK TO HOME
        </button>
      </Overlay>
    );
  }

  return (
    <div 
      className="h-screen w-full flex flex-col felt-bg select-none relative overflow-hidden"
      onMouseMove={onDragMove}
      onMouseUp={() => dragInfo && setDragInfo(null)}
      onTouchMove={onDragMove}
      onTouchEnd={() => dragInfo && setDragInfo(null)}
    >
      {/* Refined Top Header */}
      <div className="flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/60 pb-4 backdrop-blur-md border-b border-white/5 h-16 shadow-2xl">
        <div className="flex gap-2">
            <button onClick={() => setScreen('HOME')} className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg active:scale-90 transition-transform">🏠</button>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg active:scale-90 transition-transform">
                {soundEnabled ? '🔊' : '🔇'}
            </button>
        </div>
        <div className="text-center">
            <span className="text-[10px] text-white/50 font-black uppercase tracking-widest block mb-0.5 leading-none">Round</span>
            <span className="text-4xl font-black italic text-yellow-500 drop-shadow-md leading-none">{gameState.roundNumber}</span>
        </div>
        <div className="flex gap-2">
            <button 
              onClick={handleHint} 
              disabled={gameState.turnIndex !== 0 || isProcessing || gameState.phase !== 'PLAYING'}
              className={`w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg transition-all ${gameState.turnIndex === 0 && gameState.phase === 'PLAYING' ? 'active:scale-90 opacity-100' : 'opacity-20 pointer-events-none'}`}
            >
              💡
            </button>
            <button onClick={() => setScreen('SETTINGS')} className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg active:scale-90 transition-transform">⚙️</button>
        </div>
      </div>

      <div className="flex-1 relative flex flex-col pt-16">
        {/* Opponent Avatars */}
        <Avatar 
          player={gameState.players[2]} 
          pos="top-4 left-1/2 -translate-x-1/2" 
          active={gameState.turnIndex === 2 && gameState.phase === 'PLAYING'} 
          isWinner={clearingTrick?.winnerId === 2}
        />
        <Avatar 
          player={gameState.players[3]} 
          pos="top-[35%] left-2" 
          active={gameState.turnIndex === 3 && gameState.phase === 'PLAYING'} 
          isWinner={clearingTrick?.winnerId === 3}
        />
        <Avatar 
          player={gameState.players[1]} 
          pos="top-[35%] right-2" 
          active={gameState.turnIndex === 1 && gameState.phase === 'PLAYING'} 
          isWinner={clearingTrick?.winnerId === 1}
        />
        
        {/* Trick Area */}
        <div className="absolute top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[20rem] h-[20rem] flex items-center justify-center z-20 pointer-events-none">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.02]">
              <span className="text-[18rem] text-white">♥</span>
          </div>

          {(gameState.phase !== 'PASSING' || gameState.currentTrick.length > 0) && gameState.currentTrick.map((t, playIdx) => {
             const spread = 50; 
             const offsets = [
               { x: 0, y: spread, start: 'translateY(400px)', rot: '-4deg' },
               { x: spread, y: 0, start: 'translateX(300px)', rot: '12deg' },
               { x: 0, y: -spread, start: 'translateY(-400px)', rot: '6deg' },
               { x: -spread, y: 0, start: 'translateX(-300px)', rot: '-14deg' }
             ];
             const off = offsets[t.playerId] || { x:0, y:0, start:'scale(0)', rot:'0deg' };
             const winPositions = [
                { x: 0, y: 450 }, { x: 300, y: 0 }, { x: 0, y: -450 }, { x: -300, y: 0 }
             ];
             const winDir = winPositions[clearingTrick?.winnerId ?? 0];

             return (
               <div key={t.card?.id || `trick-${playIdx}`} 
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

        {/* Passing Stage */}
        {gameState.phase === 'PASSING' && (
          <div className="absolute top-[30%] left-1/2 -translate-x-1/2 flex flex-col items-center w-full z-40 px-6">
             <div className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30 mb-5">Selected to Pass</div>
             <div className="flex gap-4">
                {[0,1,2].map(i => (
                    <div key={i} className={`w-[4rem] h-20 rounded-2xl staged-slot flex items-center justify-center shadow-2xl relative transition-all duration-300`}>
                       <div className="text-white/5 text-4xl font-black">?</div>
                    </div>
                ))}
             </div>
             <button 
              onClick={handlePass}
              disabled={gameState.passingCards.length < 3}
              className={`mt-6 px-10 py-3 rounded-2xl font-black text-xl shadow-[0_10px_20px_rgba(0,0,0,0.5)] transition-all duration-300 ${gameState.passingCards.length === 3 ? 'bg-blue-600 border-b-4 border-blue-800 scale-100 active:scale-95' : 'bg-gray-800/80 opacity-40 scale-90 grayscale'}`}
            >
              Confirm Pass
            </button>
          </div>
        )}

        <div className="absolute top-[20%] w-full flex flex-col items-center pointer-events-none z-50 px-10 text-center">
           {message && (
             <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-[10px] font-black uppercase shadow-2xl border-2 border-white/20 animate-fan leading-tight">
                {message}
             </div>
           )}
        </div>
      </div>

      {/* Human Avatar Integration - Adjusted bottom offset to prevent card overlap */}
      <Avatar 
        player={gameState.players[0]} 
        pos="bottom-56 left-1/2 -translate-x-1/2" 
        active={gameState.turnIndex === 0 && gameState.phase === 'PLAYING'} 
        isWinner={clearingTrick?.winnerId === 0}
      />

      {/* Repositioned Hand Area at the very bottom */}
      <div className="relative h-48 w-full flex justify-center items-end pb-[calc(1.5rem+var(--safe-bottom))] z-40 bg-gradient-to-t from-black/40 to-transparent">
        <div className="relative h-full w-full overflow-visible">
           {gameState.players[0].hand.map((card, idx, arr) => {
             if (!card) return null;
             const isSel = gameState.passingCards.includes(card.id);
             const pIdx = gameState.passingCards.indexOf(card.id);
             
             // Perfect alignment calculation for Passing phase
             // Slot width is 4rem (64px), gap-4 is 1rem (16px)
             // Center slot is at screen center. Left/Right are at +/- 80px from center.
             const cardWidthScaled = 99.2 * 0.6; // lg card width * passing scale
             const screenCenter = window.innerWidth / 2;
             const slotOffset = (pIdx - 1) * 80; // pIdx 0 -> -80, 1 -> 0, 2 -> 80
             
             // tx calculation for passing: center the card exactly in its slot
             const tx = isSel 
                ? screenCenter + slotOffset - (cardWidthScaled / 2) 
                : (idx * handSpacing) + 16;
                
             // ty calculation for passing: move up to top-30% area
             // Current bottom area is h-48 (192px). Slots are at top-30%.
             // ty of -245 fits well with the bottom-48 parent and top-30% slots on average mobile heights
             const ty = isSel ? -245 : (idx * 0.4); 
             
             const rot = isSel ? 0 : (idx - (arr.length/2)) * 0.7;
             const scale = isSel ? 0.6 : 1;
             const isLegal = legalCardIds ? legalCardIds.has(card.id) : true;
             const showInactive = gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && !isLegal;
             const isDragging = dragInfo?.id === card.id;
             const dragOffset = isDragging ? dragInfo.currentY - dragInfo.startY : 0;
             const willPlay = isDragging && Math.abs(dragOffset) >= DRAG_THRESHOLD;
             const isHint = hintCardId === card.id;

             return (
                <div 
                  key={card.id}
                  onMouseDown={(e) => onDragStart(e, card.id)}
                  onTouchStart={(e) => onDragStart(e, card.id)}
                  onMouseUp={() => onDragEnd(card)}
                  onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab active:cursor-grabbing ${showInactive ? 'grayscale brightness-50 contrast-75 scale-[0.85] translate-y-6 shadow-none' : ''} ${isDragging ? 'z-[500] transition-none pointer-events-auto' : ''}`}
                  style={{ 
                    transform: `translate3d(${tx}px, ${ty + dragOffset}px, 0) rotate(${isDragging ? 0 : rot}deg) scale(${isDragging ? (willPlay ? 1.15 : 1) : scale})`,
                    zIndex: isDragging ? 500 : (isSel ? 300 : 100 + idx),
                    animationDelay: `${idx * 0.01}s`
                  }}
                >
                  <CardView card={card} size="lg" inactive={showInactive} highlighted={willPlay} hint={isHint} />
                  {willPlay && (
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-yellow-400 text-black font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-tighter whitespace-nowrap animate-bounce shadow-lg">
                      Play Now
                    </div>
                  )}
                </div>
             );
           })}
        </div>
      </div>

      {(gameState.phase === 'ROUND_END' || gameState.phase === 'GAME_OVER') && (
        <Overlay title={gameState.phase === 'GAME_OVER' ? "FINAL SCORE" : "ROUND OVER"} subtitle={gameState.phase === 'GAME_OVER' ? "Tournament Finished" : "Round Standings"}>
            <div className="w-full space-y-3 mb-10">
               {gameState.players.map(p => (
                 <div key={p.id} className="flex justify-between items-center bg-white/5 p-4 rounded-3xl border border-white/10 shadow-inner">
                    <div className="flex items-center gap-4">
                       <span className="text-4xl">{p.avatar}</span>
                       <div className="flex flex-col items-start text-left">
                          <span className={`font-black text-sm uppercase tracking-tight ${p.id === 0 ? 'text-yellow-400' : 'text-white'}`}>{p.name}</span>
                          <span className="text-[10px] text-white/30 font-bold tracking-[0.2em]">TOTAL: {p.score || 0}</span>
                       </div>
                    </div>
                    <div className="text-right"><div className="text-3xl font-black italic text-yellow-500">+{p.currentRoundScore || 0}</div></div>
                 </div>
               ))}
            </div>
            <button 
              onClick={() => {
                if (gameState.phase === 'GAME_OVER') setGameState(p => ({...p, players: INITIAL_PLAYERS.map(pl => ({...pl, score: 0})), roundNumber: 1, phase: 'DEALING'}));
                else setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1}));
              }} 
              className="w-full py-6 bg-green-600 rounded-[2.5rem] font-black text-2xl uppercase border-b-8 border-green-800 active:translate-y-2 transition-all shadow-xl"
            >
              {gameState.phase === 'GAME_OVER' ? "RESTART GAME" : "NEXT ROUND"}
            </button>
        </Overlay>
      )}
    </div>
  );
}

const SettingToggle = memo(({ label, desc, active, onClick }: { label: string, desc: string, active: boolean, onClick: () => void }) => {
  return (
    <div onClick={onClick} className="w-full flex justify-between items-center bg-white/5 p-5 rounded-[2rem] border border-white/10 shadow-inner cursor-pointer active:scale-95 transition-all">
       <div className="flex flex-col items-start text-left pr-4">
          <span className="font-black text-xl text-white uppercase tracking-tight">{label}</span>
          <span className="text-[10px] text-white/40 font-bold">{desc}</span>
       </div>
       <div className={`w-14 h-8 rounded-full p-1 transition-colors duration-300 ${active ? 'bg-green-500' : 'bg-white/10'}`}>
          <div className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${active ? 'translate-x-6' : 'translate-x-0'}`} />
       </div>
    </div>
  );
});
