import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
const DRAG_THRESHOLD = 80;

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
      playPromise.catch(error => {
        console.warn("Playback failed. User must interact first.", error);
      });
    }
  } catch (e) {
    console.error("Audio system error", e);
  }
};

function Overlay({ title, subtitle, children, fullWidth = false }: { title: string, subtitle: string, children?: React.ReactNode, fullWidth?: boolean }) {
  return (
    <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 text-center animate-play">
       <h2 className="text-5xl font-black text-yellow-500 italic mb-1 tracking-tighter drop-shadow-2xl">{title}</h2>
       <p className="text-white/30 text-[9px] font-black uppercase tracking-[0.5em] mb-8">{subtitle}</p>
       <div className={`w-full ${fullWidth ? 'max-w-xl' : 'max-w-sm'}`}>{children}</div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('MENU');
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
    passingCards: ["", "", ""],
    settings: settings
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPassFinalized, setIsPassFinalized] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [hintCardId, setHintCardId] = useState<string | null>(null);
  const [receivedCards, setReceivedCards] = useState<string[]>([]);
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
        passingCards: ["", "", ""]
      };
    });

    setHintCardId(null);
    setReceivedCards([]);
    setIsPassFinalized(false);
    if (!isPassingRound) {
       const msg = settings.noPassing ? "No-Passing Game Mode" : "Round 4: No Pass. 2 of Clubs leads.";
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
    const activePassCount = gameState.passingCards.filter(Boolean).length;
    if (activePassCount !== 3 || isProcessing) return;
    
    setIsProcessing(true);
    setIsPassFinalized(true);

    const cycle = (gameState.roundNumber - 1) % 4;
    const shift = cycle === 0 ? 1 : cycle === 1 ? 3 : 2;

    const passedCardsByPlayer: Record<number, Card[]> = {};
    gameState.players.forEach(p => {
      if (p.isHuman) {
        passedCardsByPlayer[p.id] = p.hand.filter(c => c && gameState.passingCards.includes(c.id));
      } else {
        const sorted = [...p.hand].sort((a, b) => {
           if (!a || !b) return 0;
           const weight = (c: Card) => (c.id === 'Q-SPADES' ? 1000 : c.suit === 'HEARTS' ? 100 + c.value : c.value);
           return weight(b) - weight(a);
        });
        passedCardsByPlayer[p.id] = sorted.slice(0, 3);
      }
    });

    const newPlayers = gameState.players.map(p => {
      const sourcePlayerId = (p.id - shift + 4) % 4;
      const receivingCards = passedCardsByPlayer[sourcePlayerId] || [];
      const removedCards = passedCardsByPlayer[p.id] || [];
      const remainingHand = p.hand.filter(c => c && !removedCards.some(rc => rc && rc.id === c.id));
      const updatedHand = [...remainingHand, ...receivingCards].sort((a, b) => {
         if (!a || !b) return 0;
         if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
         return b.value - a.value;
      });

      if (p.id === 0) {
         setReceivedCards(receivingCards.map(c => c.id));
      }
      return { ...p, hand: updatedHand };
    });

    let starter = 0;
    newPlayers.forEach((p, i) => { 
      if (p.hand.some(c => c && c.id === '2-CLUBS')) starter = i; 
    });

    setGameState(prev => ({ 
      ...prev, 
      players: newPlayers, 
      passingCards: ["", "", ""] 
    }));

    setTimeout(() => {
      setGameState(prev => ({
        ...prev,
        phase: 'PLAYING',
        turnIndex: starter
      }));
      setReceivedCards([]);
      setIsProcessing(false);
      setMessage("");
    }, 2500);
  };

  const togglePassingCard = useCallback((cardId: string) => {
    setGameState(prev => {
      if (prev.phase !== 'PASSING' || isPassFinalized) return prev;
      const currentPass = [...prev.passingCards];
      const existingIdx = currentPass.indexOf(cardId);
      
      if (existingIdx !== -1) {
        currentPass[existingIdx] = "";
        return { ...prev, passingCards: currentPass };
      } else {
        const firstEmpty = currentPass.findIndex(id => !id);
        if (firstEmpty !== -1) {
          currentPass[firstEmpty] = cardId;
          return { ...prev, passingCards: currentPass };
        }
        return prev;
      }
    });
  }, [isPassFinalized]);

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
                newPlayers.forEach(p => { 
                  if (p.currentRoundScore === 26) moonShooterId = p.id; 
                });
              }

              const finalPlayers = newPlayers.map(p => {
                 let added = p.currentRoundScore || 0;
                 if (moonShooterId !== -1) added = (p.id === moonShooterId) ? 0 : 26;
                 return { ...p, score: (p.score || 0) + added, currentRoundScore: p.currentRoundScore };
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
    const cardWidthLg = 86.4; 
    const targetRightEdge = window.innerWidth + (cardWidthLg / 2);
    const availableSpan = targetRightEdge - leftMargin - cardWidthLg;
    const spacing = availableSpan / (count - 1);
    return Math.max(16, Math.min(60, spacing));
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
    if (dragInfo || isProcessing) return; 
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
    } else if (deltaY < 5) { // It's a click
       if (gameState.phase === 'PASSING') togglePassingCard(card.id);
       else handleHumanPlay(card);
    }
    setDragInfo(null);
  };

  if (screen === 'MENU') {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center felt-bg overflow-hidden">
        <div className="text-9xl mb-4 drop-shadow-2xl animate-bounce">♥️</div>
        <h1 className="text-8xl font-black text-yellow-500 italic mb-2 tracking-tighter drop-shadow-lg text-center leading-[0.85]">HEARTS</h1>
        <p className="text-white/40 text-[11px] tracking-[0.5em] font-bold mb-16 uppercase">Professional Offline Edition</p>
        <div className="flex flex-col gap-4 w-full max-w-xs px-4">
          <button 
            onClick={() => { 
                if (soundEnabled) playSound(SOUNDS.PLAY, 0.4); 
                setGameState(p => ({...p, players: INITIAL_PLAYERS.map(pl => ({...pl, score: 0})), roundNumber: 1, phase: 'DEALING'})); 
                setScreen('GAME'); 
            }}
            className="w-full py-6 bg-green-600 rounded-[2.5rem] text-3xl font-black shadow-2xl active:scale-95 transition-transform border-b-8 border-green-800"
          >
            START GAME
          </button>
          <button 
            onClick={() => setScreen('SETTINGS')}
            className="w-full py-4 bg-black/40 rounded-[2rem] text-xl font-bold border border-white/10 active:scale-95 transition-transform"
          >
            SETTINGS
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
          onClick={() => setScreen('MENU')}
          className="w-full py-6 bg-yellow-500 text-black rounded-[2.5rem] font-black text-2xl uppercase border-b-8 border-yellow-700 active:translate-y-2 transition-all shadow-xl"
        >
          BACK TO MENU
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
      <div className="flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/60 pb-4 backdrop-blur-md border-b border-white/5 h-16 shadow-2xl">
        <div className="flex gap-2">
            <button onClick={() => setScreen('SETTINGS')} className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg active:scale-90 transition-transform">⚙️</button>
            <button onClick={() => setSoundEnabled(!soundEnabled)} className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg active:scale-90 transition-transform">
                {soundEnabled ? '🔊' : '🔇'}
            </button>
        </div>
        <div className="text-center">
            <span className="text-[10px] text-white/50 font-black uppercase tracking-widest block mb-0.5 leading-none">Round</span>
            <span className="text-4xl font-black italic text-yellow-500 drop-shadow-md leading-none">{gameState.roundNumber}</span>
        </div>
        <div className="w-10 h-10 bg-black/40 rounded-xl flex items-center justify-center border border-white/10 text-xl shadow-lg">📊</div>
      </div>

      <div className="flex-1 relative flex flex-col pt-4 overflow-hidden">
        <Avatar 
          player={gameState.players[2]} 
          pos="top-6 left-1/2 -translate-x-1/2" 
          active={gameState.turnIndex === 2 && gameState.phase === 'PLAYING'} 
          isWinner={clearingTrick?.winnerId === 2}
          isLeading={gameState.currentTrick.length > 0 && gameState.currentTrick[0]?.playerId === 2}
        />
        <Avatar 
          player={gameState.players[3]} 
          pos="top-[42%] left-2" 
          active={gameState.turnIndex === 3 && gameState.phase === 'PLAYING'} 
          isWinner={clearingTrick?.winnerId === 3}
          isLeading={gameState.currentTrick.length > 0 && gameState.currentTrick[0]?.playerId === 3}
        />
        <Avatar 
          player={gameState.players[1]} 
          pos="top-[42%] right-2" 
          active={gameState.turnIndex === 1 && gameState.phase === 'PLAYING'} 
          isWinner={clearingTrick?.winnerId === 1}
          isLeading={gameState.currentTrick.length > 0 && gameState.currentTrick[0]?.playerId === 1}
        />
        
        {/* YOU (P0) - Positioned just above the cards hand */}
        <Avatar 
          player={gameState.players[0]} 
          pos="bottom-[13.5rem] left-1/2 -translate-x-1/2" 
          active={gameState.turnIndex === 0 && gameState.phase === 'PLAYING'} 
          isWinner={clearingTrick?.winnerId === 0}
          isLeading={gameState.currentTrick.length > 0 && gameState.currentTrick[0]?.playerId === 0}
        />

        <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[22rem] h-[22rem] flex items-center justify-center z-20 pointer-events-none">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03]">
              <span className="text-[20rem] text-white">♥</span>
          </div>

          {(gameState.phase !== 'PASSING' || gameState.currentTrick.length > 0) && gameState.currentTrick.map((t, playIdx) => {
             const spreadX = 55; 
             const spreadY = 85;
             const offsets = [
               { x: 0, y: spreadY, start: 'translateY(400px)', rot: '-4deg' },
               { x: spreadX, y: 0, start: 'translateX(300px)', rot: '12deg' },
               { x: 0, y: -spreadY, start: 'translateY(-400px)', rot: '6deg' },
               { x: -spreadX, y: 0, start: 'translateX(-300px)', rot: '-14deg' }
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

        {gameState.phase === 'PASSING' && !isPassFinalized && (
          <div className="absolute top-[30%] left-1/2 -translate-x-1/2 flex flex-col items-center w-full z-40 px-6">
             <div className="text-[11px] font-black uppercase tracking-[0.4em] text-white/30 mb-5">Selected to Pass</div>
             <div className="flex gap-4">
                {[0,1,2].map(i => (
                    <div key={i} className={`w-[3.6rem] h-[4.8rem] rounded-2xl staged-slot flex items-center justify-center shadow-2xl relative transition-all duration-300`}>
                       <div className="text-white/5 text-4xl font-black">?</div>
                    </div>
                ))}
             </div>
             <button 
              onClick={handlePass}
              disabled={gameState.passingCards.filter(Boolean).length < 3 || isProcessing}
              className={`mt-6 px-10 py-3 rounded-2xl font-black text-xl shadow-[0_10px_20px_rgba(0,0,0,0.5)] transition-all duration-300 ${gameState.passingCards.filter(Boolean).length === 3 && !isProcessing ? 'bg-blue-600 border-b-4 border-blue-800 scale-100 active:scale-95' : 'bg-gray-800/80 opacity-40 scale-90 grayscale'}`}
            >
              Pass Cards
            </button>
          </div>
        )}

        <div className="absolute top-[18%] w-full flex flex-col items-center pointer-events-none z-50 px-10 text-center">
           {message && (
             <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-xs font-black uppercase shadow-2xl border-2 border-white/20 animate-fan leading-tight">
                {message}
             </div>
           )}
        </div>
      </div>

      <div className="fixed bottom-24 w-full h-1 z-[60] flex justify-center items-end pointer-events-none">
        <div className="relative h-full w-full overflow-visible pointer-events-none">
           {gameState.players[0].hand.map((card, idx, arr) => {
             if (!card) return null;
             const isSel = gameState.passingCards.includes(card.id);
             const pIdx = gameState.passingCards.indexOf(card.id);
             
             const slotSpacing = 73.6; 
             const centerX = window.innerWidth / 2;
             const scaledCardWidth = 86.4 * 0.66; 
             
             const tx = isSel ? (centerX + (pIdx - 1) * slotSpacing - (scaledCardWidth / 2)) : (idx * handSpacing) + 16;
             const h = window.innerHeight;
             const ty = isSel ? (0.3 * h + 31) - (h - 96) : (idx * 0.4); 
             
             const rot = isSel ? 0 : (idx - (arr.length/2)) * 0.8;
             const scale = isSel ? 0.66 : 1;
             const isLegal = legalCardIds ? legalCardIds.has(card.id) : true;
             const showInactive = gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && !isLegal;
             const isDragging = dragInfo?.id === card.id;
             const dragOffset = isDragging ? dragInfo.currentY - dragInfo.startY : 0;
             const willPlay = isDragging && Math.abs(dragOffset) >= DRAG_THRESHOLD;
             const isHint = hintCardId === card.id;
             const isNew = receivedCards.includes(card.id);

             return (
                <div 
                  key={card.id}
                  onMouseDown={(e) => onDragStart(e, card.id)}
                  onTouchStart={(e) => onDragStart(e, card.id)}
                  onMouseUp={() => onDragEnd(card)}
                  onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab active:cursor-grabbing pointer-events-auto ${showInactive ? 'grayscale brightness-50 contrast-75 scale-[0.85] translate-y-6 shadow-none' : ''} ${isDragging ? 'z-[500] transition-none' : ''}`}
                  style={{ 
                    transform: `translateX(${tx}px) translateY(${ty + dragOffset}px) rotate(${isDragging ? 0 : rot}deg) scale(${isDragging ? (willPlay ? 1.15 : 1) : scale})`,
                    zIndex: isDragging ? 500 : (isSel ? 300 : 100 + idx),
                    animationDelay: `${idx * 0.03}s`
                  }}
                >
                  <CardView card={card} size="lg" inactive={showInactive} highlighted={willPlay} hint={isHint} isNew={isNew} />
                  {willPlay && (
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-yellow-400 text-black font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-tighter whitespace-nowrap animate-bounce shadow-lg">
                      Release to Play
                    </div>
                  )}
                </div>
             );
           })}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 h-16 bg-black/95 backdrop-blur-2xl border-t border-white/5 pb-[var(--safe-bottom)] z-50 shadow-[0_-10px_40px_rgba(0,0,0,0.8)] flex justify-around items-center">
        <NavItem icon="🃏" label="Games" onClick={() => setScreen('MENU')} />
        <NavItem icon="ℹ" label="Info" />
        <NavItem icon="🎴" label="Play" active={gameState.phase === 'PLAYING'} />
        <NavItem icon="💡" label="Hint" onClick={handleHint} disabled={gameState.turnIndex !== 0 || isProcessing || gameState.phase !== 'PLAYING'} />
        <NavItem icon="🛡️" label="Tiers" />
      </div>

      {(gameState.phase === 'ROUND_END' || gameState.phase === 'GAME_OVER') && (
        <Overlay title={gameState.phase === 'GAME_OVER' ? "FINAL SCORES" : "ROUND RECAP"} subtitle={gameState.phase === 'GAME_OVER' ? "Game Finished" : `Round ${gameState.roundNumber} Complete`}>
            <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-[2rem] p-5 w-full mb-8 shadow-2xl overflow-hidden">
               <div className="grid grid-cols-4 gap-2 mb-4 text-[8px] font-black uppercase tracking-[0.2em] text-white/30 border-b border-white/5 pb-2">
                 <div className="col-span-2 text-left pl-2">Player</div>
                 <div>Round</div>
                 <div>Total</div>
               </div>
               <div className="space-y-1">
                  {gameState.players.map(p => (
                    <div key={p.id} className={`grid grid-cols-4 gap-2 items-center py-2 rounded-xl transition-colors ${p.id === 0 ? 'bg-white/5' : ''}`}>
                       <div className="col-span-2 flex items-center gap-2 pl-2 overflow-hidden">
                          <span className="text-xl">{p.avatar}</span>
                          <span className={`text-[10px] font-black uppercase truncate tracking-tight ${p.id === 0 ? 'text-yellow-400' : 'text-white/70'}`}>{p.name}</span>
                       </div>
                       <div className="text-xs font-black text-yellow-500 italic">+{p.currentRoundScore || 0}</div>
                       <div className="text-xs font-bold text-white/90">{p.score + (p.currentRoundScore || 0)}</div>
                    </div>
                  ))}
               </div>
            </div>

            <button 
              onClick={() => {
                if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
                if (gameState.phase === 'GAME_OVER') setGameState(p => ({...p, players: INITIAL_PLAYERS.map(pl => ({...pl, score: 0})), roundNumber: 1, phase: 'DEALING'}));
                else setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1}));
              }} 
              className="w-full py-5 bg-green-600 rounded-[2rem] font-black text-xl uppercase border-b-4 border-green-800 active:translate-y-1 transition-all shadow-xl"
            >
              {gameState.phase === 'GAME_OVER' ? "NEW TOURNAMENT" : "DEAL NEXT ROUND"}
            </button>
        </Overlay>
      )}
    </div>
  );
}

function SettingToggle({ label, desc, active, onClick }: { label: string, desc: string, active: boolean, onClick: () => void }) {
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
}

function Avatar({ player, pos, active, isWinner = false, isLeading = false }: { player: Player, pos: string, active: boolean, isWinner?: boolean, isLeading?: boolean }) {
  if (!player) return null;
  return (
    <div className={`absolute ${pos} flex flex-col items-center transition-all duration-500 z-10 ${active ? 'opacity-100 scale-110' : 'opacity-60 scale-95'} ${isWinner ? 'scale-125' : ''}`}>
      {isLeading && <div className="absolute -bottom-8 bg-white/20 text-white px-2 py-0.5 rounded-md text-[6px] font-black uppercase tracking-widest border border-white/20 backdrop-blur-md shadow-lg z-20">Lead</div>}
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-3xl shadow-[0_10px_30px_rgba(0,0,0,0.7)] border transition-all duration-500 ${isWinner ? 'winner-glow bg-yellow-400 border-yellow-200' : 'bg-black/70 border-white/20'} ${active ? 'border-yellow-500 ring-2 ring-yellow-500/30' : ''}`}>{player.avatar}</div>
      <div className="flex flex-col items-center mt-1">
          <div className="text-lg font-black italic drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] text-white leading-none">
            {player.score + (player.currentRoundScore || 0)}
          </div>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick, disabled = false }: { icon: string, label: string, active?: boolean, onClick?: () => void, disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`flex flex-col items-center gap-1 transition-all duration-300 ${active ? 'text-yellow-500 scale-110' : 'text-white/20'} ${disabled ? 'opacity-20 pointer-events-none' : 'active:scale-90'}`}>
      <span className="text-xl">{icon}</span>
      <span className="text-[8px] font-black uppercase tracking-widest">{label}</span>
      {active && <div className="w-1 h-1 rounded-full bg-yellow-500 mt-1 shadow-[0_0_8px_yellow]" />}
    </button>
  );
}

function CardView({ card, size = 'md', inactive = false, highlighted = false, hint = false, isNew = false }: { card: Card, size?: 'sm' | 'md' | 'lg', inactive?: boolean, highlighted?: boolean, hint?: boolean, isNew?: boolean }) {
  if (!card) return null;
  
  const dims = size === 'sm' ? 'w-[3.6rem] h-[4.8rem] p-[0.35rem]' : size === 'md' ? 'w-[4.5rem] h-[6rem] p-[0.45rem]' : 'w-[5.4rem] h-[7.2rem] p-[0.6rem]';
  const rankStyle = size === 'sm' ? 'text-sm' : size === 'md' ? 'text-lg' : 'text-xl';
  const cornerSymStyle = size === 'sm' ? 'text-[8px]' : size === 'md' ? 'text-[10px]' : 'text-xs';
  const brSymStyle = size === 'sm' ? 'text-lg' : size === 'md' ? 'text-xl' : 'text-2xl';
  const hugeIconStyle = size === 'sm' ? 'text-4xl' : size === 'md' ? 'text-5xl' : 'text-6xl';
  
  const showRing = highlighted || hint || isNew;
  const ringColor = hint ? 'ring-blue-400 shadow-[0_0_30px_rgba(59,130,246,0.8)]' : 
                    isNew ? 'ring-green-400 shadow-[0_0_40px_rgba(34,197,94,1)]' :
                    'ring-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.6)]';

  return (
    <div className={`${dims} bg-white rounded-xl card-shadow flex flex-col items-start justify-start ${inactive ? '' : 'border-b-[4px]'} border-gray-300 ${SUIT_COLORS[card.suit] || 'text-black'} relative overflow-hidden transition-all duration-300 ${showRing ? `ring-4 ${ringColor}` : ''} ${hint || isNew ? 'animate-pulse' : ''}`}>
      <div className="flex flex-col items-start leading-none z-10">
        <div className={`font-black tracking-tighter ${rankStyle}`}>{card.rank}</div>
        <div className={`${cornerSymStyle} mt-0.5`}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.06] ${hugeIconStyle} leading-none pointer-events-none rotate-[-8deg]`}>{SUIT_SYMBOLS[card.suit]}</div>
      <div className={`absolute bottom-1 right-1 leading-none z-10 ${brSymStyle} pointer-events-none`}>{SUIT_SYMBOLS[card.suit]}</div>
      {inactive && <div className="absolute inset-0 bg-black/10 backdrop-blur-[0.5px]" />}
    </div>
  );
}