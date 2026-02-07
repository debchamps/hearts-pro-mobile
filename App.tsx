
import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { GameState, Player, Card, GamePhase, Suit, ScreenState, GameSettings, GameType, TrickCard } from './types';
import { createDeck, shuffle, SUIT_SYMBOLS, SUIT_COLORS } from './constants';
import { getBestMove } from './services/geminiService';
import { getSpadesBid, getSpadesMove } from './services/spadesAi';

const DEFAULT_SETTINGS: GameSettings = {
  shootTheMoon: true,
  noPassing: false,
  jackOfDiamonds: false,
  targetScore: 100,
};

const INITIAL_PLAYERS: Player[] = [
  { id: 0, name: 'YOU', avatar: '👤', hand: [], score: 0, currentRoundScore: 0, isHuman: true, teamId: 0, tricksWon: 0 },
  { id: 1, name: 'FISH', avatar: '🐟', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 1, tricksWon: 0 },
  { id: 2, name: 'SNAKE', avatar: '🐍', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 0, tricksWon: 0 },
  { id: 3, name: 'SHRIMP', avatar: '🦐', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 1, tricksWon: 0 },
];

const SOUNDS = {
  PLAY: 'https://cdn.pixabay.com/audio/2022/03/10/audio_f53093282f.mp3',
  CLEAR: 'https://cdn.pixabay.com/audio/2022/03/10/audio_c3523e4291.mp3',
  SCORE: 'https://cdn.pixabay.com/audio/2021/08/04/audio_0625615d9a.mp3',
};

const playSound = (url: string, volume = 0.4) => {
  try {
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {});
  } catch (e) {}
};

const GAMES_LIST = [
  { id: 'hearts', name: 'Hearts', icon: '♥️', available: true, color: 'bg-red-500' },
  { id: 'spades', name: 'Spades', icon: '♠️', available: true, color: 'bg-indigo-600' },
  { id: 'callbreak', name: 'Callbreak', icon: '👑', available: false, color: 'bg-purple-600' },
  { id: 'bray', name: 'Bray', icon: '🃏', available: false, color: 'bg-amber-600' },
  { id: '29', name: '29', icon: '🎴', available: false, color: 'bg-emerald-600' },
  { id: 'bridge', name: 'Bridge', icon: '🌉', available: false, color: 'bg-cyan-600' },
];

const Overlay = memo(({ title, subtitle, children, fullWidth = false }: { title: string, subtitle: string, children?: React.ReactNode, fullWidth?: boolean }) => (
  <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 text-center animate-play">
     <h2 className="text-5xl font-black text-yellow-500 italic mb-1 tracking-tighter drop-shadow-2xl uppercase">{title}</h2>
     <p className="text-white/30 text-[9px] font-black uppercase tracking-[0.5em] mb-8">{subtitle}</p>
     <div className={`w-full ${fullWidth ? 'max-w-xl' : 'max-w-sm'}`}>{children}</div>
  </div>
));

const Avatar = memo(({ player, pos, active, isWinner = false, gameType = 'HEARTS' }: { player: Player, pos: string, active: boolean, isWinner?: boolean, gameType?: GameType }) => {
  const isTeamBlue = player.teamId === 0;
  const teamColor = isTeamBlue ? 'border-blue-500' : 'border-rose-500';
  const teamGlow = isTeamBlue ? 'shadow-[0_0_20px_rgba(37,99,235,0.6)]' : 'shadow-[0_0_20px_rgba(244,63,94,0.6)]';
  const teamBg = isTeamBlue ? 'bg-blue-600/20' : 'bg-rose-600/20';
  const badgeColor = isTeamBlue ? 'bg-blue-600' : 'bg-rose-600';

  return (
    <div className={`absolute ${pos} flex flex-col items-center transition-all duration-500 z-10 ${active ? 'opacity-100 scale-110' : 'opacity-80 scale-95'} ${isWinner ? 'scale-125' : ''}`}>
      <div className={`relative w-16 h-16 rounded-3xl flex items-center justify-center text-4xl shadow-2xl border-4 transition-all duration-500 backdrop-blur-md ${isWinner ? 'winner-glow bg-yellow-400 border-yellow-200' : `bg-black/60 ${teamBg} ${teamColor} ${teamGlow}`} ${active ? 'ring-4 ring-yellow-400/50' : ''}`}>
        {player.avatar}
        <div className={`absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center ${badgeColor} shadow-lg z-20`}>
           <span className="text-[10px] font-black text-white leading-none">{isTeamBlue ? 'B' : 'R'}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-col items-center pointer-events-none">
        <div className={`flex items-center h-7 rounded-lg overflow-hidden border border-white/20 shadow-xl backdrop-blur-md`}>
          <div className={`${badgeColor} px-3 h-full flex items-center justify-center text-[13px] font-black text-white min-w-[32px]`}>
            {gameType === 'HEARTS' ? (player.score + (player.currentRoundScore || 0)) : (player.tricksWon || 0)}
          </div>
          <div className="bg-black/80 px-2 h-full flex items-center justify-center text-[9px] font-black text-white/40 uppercase tracking-tighter min-w-[28px]">
            {gameType === 'HEARTS' ? 'pts' : `/${player.bid || 0}`}
          </div>
        </div>
        <span className="text-[10px] font-black uppercase text-white/50 tracking-[0.15em] mt-1 drop-shadow-md">{player.name}</span>
      </div>
    </div>
  );
});

const CardView = memo(({ card, size = 'md', inactive = false, highlighted = false, hint = false }: { card: Card, size?: 'sm' | 'md' | 'lg', inactive?: boolean, highlighted?: boolean, hint?: boolean }) => {
  if (!card) return null;
  const dims = size === 'sm' ? 'w-[4rem] h-[5.33rem] p-1.5' : size === 'md' ? 'w-[5rem] h-[6.66rem] p-2' : 'w-[5.8rem] h-[7.8rem] p-2';
  const rankStyle = size === 'sm' ? 'text-sm' : size === 'md' ? 'text-lg' : 'text-xl';
  const cornerSymStyle = size === 'sm' ? 'text-[8px]' : size === 'md' ? 'text-[10px]' : 'text-xs';
  const brSymStyle = size === 'sm' ? 'text-lg' : size === 'md' ? 'text-xl' : 'text-2xl';
  const hugeIconStyle = size === 'sm' ? 'text-5xl' : size === 'md' ? 'text-6xl' : 'text-7xl';
  const showRing = highlighted || hint;
  const ringColor = hint ? 'ring-cyan-400 shadow-[0_0_35px_rgba(34,211,238,0.9)]' : 'ring-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.6)]';

  return (
    <div className={`${dims} bg-white rounded-lg card-shadow flex flex-col items-start justify-start border-gray-300 ${SUIT_COLORS[card.suit] || 'text-black'} relative overflow-hidden transition-all duration-300 ${showRing ? `ring-4 ${ringColor}` : ''} ${hint ? 'animate-pulse' : ''}`}>
      <div className="flex flex-col items-start leading-none z-10"><div className={`font-black tracking-tighter ${rankStyle}`}>{card.rank}</div><div className={`${cornerSymStyle} mt-0.5`}>{SUIT_SYMBOLS[card.suit]}</div></div>
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.08] ${hugeIconStyle} leading-none pointer-events-none rotate-[-8deg]`}>{SUIT_SYMBOLS[card.suit]}</div>
      <div className={`absolute bottom-1 right-1 leading-none z-10 ${brSymStyle} pointer-events-none`}>{SUIT_SYMBOLS[card.suit]}</div>
      {inactive && <div className="absolute inset-0 bg-black/10 backdrop-blur-[0.5px]" />}
    </div>
  );
});

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('HOME');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [gameState, setGameState] = useState<GameState>({
    gameType: 'HEARTS',
    players: INITIAL_PLAYERS,
    dealerIndex: 0,
    turnIndex: -1,
    leadSuit: null,
    currentTrick: [],
    heartsBroken: false,
    spadesBroken: false,
    phase: 'DEALING',
    roundNumber: 1,
    passingCards: [],
    settings: settings,
    teamScores: [0, 0],
    teamBags: [0, 0]
  });

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [clearingTrick, setClearingTrick] = useState<{ winnerId: number } | null>(null);
  const [hintCardId, setHintCardId] = useState<string | null>(null);
  const [dragInfo, setDragInfo] = useState<{ id: string; startY: number; currentY: number } | null>(null);

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
      tricksWon: 0,
      bid: undefined
    }));

    const cycle = (gameState.roundNumber - 1) % 4;
    const isPassingRound = gameState.gameType === 'HEARTS' && !settings.noPassing && cycle !== 3;

    setGameState(prev => {
      let turnIdx = prev.dealerIndex; 
      let phase: GamePhase = isPassingRound ? 'PASSING' : (prev.gameType === 'SPADES' ? 'BIDDING' : 'PLAYING');
      
      if (phase === 'PLAYING' && prev.gameType === 'HEARTS') {
        players.forEach((p, i) => { if (p.hand.some(c => c.id === '2-CLUBS')) turnIdx = i; });
      }

      return {
        ...prev,
        players,
        phase,
        turnIndex: turnIdx,
        currentTrick: [],
        leadSuit: null,
        heartsBroken: false,
        spadesBroken: false,
        passingCards: []
      };
    });

    setHintCardId(null);
    if (gameState.gameType === 'HEARTS') {
      setMessage(isPassingRound ? `Pass 3 cards ${cycle === 0 ? "Left" : cycle === 1 ? "Right" : "Across"}` : "2 of Clubs leads.");
    } else {
      setMessage("Place your Bids");
    }
  }, [gameState.players, gameState.roundNumber, settings, gameState.gameType]);

  useEffect(() => {
    if (gameState.phase === 'DEALING' && screen === 'GAME') {
      const timer = setTimeout(startRound, 600);
      return () => clearTimeout(timer);
    }
  }, [gameState.phase, startRound, screen]);

  const playCard = useCallback((playerId: number, cardId: string) => {
    if (soundEnabled) playSound(SOUNDS.PLAY, 0.4);
    setGameState(prev => {
      if (prev.currentTrick.length >= 4) return prev;
      const player = prev.players[playerId];
      const card = player.hand.find(c => c.id === cardId);
      if (!card) return prev;

      const newHand = player.hand.filter(c => c.id !== cardId);
      const newPlayers = prev.players.map(p => p.id === playerId ? { ...p, hand: newHand } : p);
      const newTrick = [...prev.currentTrick, { playerId, card }];
      let newLeadSuit = prev.currentTrick.length === 0 ? card.suit : prev.leadSuit;
      let newHeartsBroken = prev.heartsBroken || card.suit === 'HEARTS';
      let newSpadesBroken = prev.spadesBroken || card.suit === 'SPADES';

      return {
        ...prev,
        players: newPlayers,
        currentTrick: newTrick,
        leadSuit: newLeadSuit,
        heartsBroken: newHeartsBroken,
        spadesBroken: newSpadesBroken,
        turnIndex: (prev.turnIndex + 1) % 4,
      };
    });
    setHintCardId(null);
  }, [soundEnabled]);

  const handleSpadesBid = (bid: number) => {
    setGameState(prev => {
      const newPlayers = [...prev.players];
      newPlayers[0].bid = bid;
      return { ...prev, players: newPlayers, turnIndex: 1 };
    });
  };

  useEffect(() => {
    if (gameState.phase === 'BIDDING' && gameState.turnIndex !== 0 && !isProcessing && gameState.gameType === 'SPADES') {
      const runBid = async () => {
        setIsProcessing(true);
        const player = gameState.players[gameState.turnIndex];
        const bid = await getSpadesBid(player.hand);
        setGameState(prev => {
          const newPlayers = [...prev.players];
          newPlayers[prev.turnIndex].bid = bid;
          const nextTurn = (prev.turnIndex + 1) % 4;
          return {
            ...prev,
            players: newPlayers,
            turnIndex: nextTurn,
            phase: nextTurn === 0 ? 'PLAYING' : 'BIDDING'
          };
        });
        setIsProcessing(false);
      };
      runBid();
    }
  }, [gameState.phase, gameState.turnIndex, gameState.gameType, isProcessing]);

  useEffect(() => {
    const activePlayer = gameState.players[gameState.turnIndex];
    if (gameState.phase === 'PLAYING' && activePlayer && !activePlayer.isHuman && !isProcessing && screen === 'GAME' && !clearingTrick && gameState.currentTrick.length < 4) {
      const runAi = async () => {
        setIsProcessing(true);
        try {
          let cardId = '';
          if (gameState.gameType === 'HEARTS') {
            const isFirstTrick = gameState.players.reduce((sum, p) => sum + p.hand.length, 0) === 52;
            cardId = await getBestMove(activePlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.heartsBroken, isFirstTrick, activePlayer.name, settings);
          } else {
            cardId = await getSpadesMove(activePlayer.hand, gameState.currentTrick, gameState.leadSuit, gameState.spadesBroken, gameState.players, gameState.turnIndex);
          }
          if (cardId) playCard(gameState.turnIndex, cardId);
        } finally { setIsProcessing(false); }
      };
      runAi();
    }
  }, [gameState.turnIndex, gameState.phase, screen, isProcessing, clearingTrick, gameState.currentTrick.length, gameState.gameType]);

  useEffect(() => {
    if (gameState.currentTrick.length === 4) {
      const timer = setTimeout(() => {
        const firstCard = gameState.currentTrick[0];
        const leadSuit = firstCard.card.suit;
        
        let winner = gameState.currentTrick[0];
        for (let i = 1; i < 4; i++) {
          const curr = gameState.currentTrick[i];
          if (curr.card.suit === winner.card.suit) {
            if (curr.card.value > winner.card.value) winner = curr;
          } else if (curr.card.suit === 'SPADES' && gameState.gameType === 'SPADES') {
            winner = curr;
          }
        }
        
        setClearingTrick({ winnerId: winner.playerId });
        if (soundEnabled) playSound(SOUNDS.CLEAR, 0.4);

        setTimeout(() => {
          setGameState(prev => {
            const newPlayers = prev.players.map(p => p.id === winner.playerId ? { ...p, tricksWon: (p.tricksWon || 0) + 1, currentRoundScore: p.currentRoundScore + (prev.gameType === 'HEARTS' ? prev.currentTrick.reduce((s, t) => s + t.card.points, 0) : 0) } : p);
            
            if (newPlayers[0].hand.length === 0) {
              if (prev.gameType === 'HEARTS') {
                let moonShooterId = -1;
                if (settings.shootTheMoon) newPlayers.forEach(p => { if (p.currentRoundScore === 26) moonShooterId = p.id; });
                const finalPlayers = newPlayers.map(p => ({ ...p, score: p.score + (moonShooterId !== -1 ? (p.id === moonShooterId ? 0 : 26) : p.currentRoundScore), currentRoundScore: 0 }));
                return { ...prev, players: finalPlayers, phase: finalPlayers.some(p => p.score >= prev.settings.targetScore) ? 'GAME_OVER' : 'ROUND_END', currentTrick: [], leadSuit: null };
              } else {
                const team0Bid = newPlayers[0].bid! + newPlayers[2].bid!;
                const team1Bid = newPlayers[1].bid! + newPlayers[3].bid!;
                const team0Tricks = newPlayers[0].tricksWon! + newPlayers[2].tricksWon!;
                const team1Tricks = newPlayers[1].tricksWon! + newPlayers[3].tricksWon!;
                
                let s0 = prev.teamScores[0], s1 = prev.teamScores[1], b0 = prev.teamBags[0], b1 = prev.teamBags[1];
                if (team0Tricks >= team0Bid) { s0 += team0Bid * 10 + (team0Tricks - team0Bid); b0 += (team0Tricks - team0Bid); } else s0 -= team0Bid * 10;
                if (team1Tricks >= team1Bid) { s1 += team1Bid * 10 + (team1Tricks - team1Bid); b1 += (team1Tricks - team1Bid); } else s1 -= team1Bid * 10;
                
                if (b0 >= 10) { s0 -= 100; b0 -= 10; }
                if (b1 >= 10) { s1 -= 100; b1 -= 10; }
                
                const over = s0 >= 500 || s1 >= 500;
                return { ...prev, players: newPlayers, teamScores: [s0, s1], teamBags: [b0, b1], phase: over ? 'GAME_OVER' : 'ROUND_END', currentTrick: [], leadSuit: null };
              }
            }
            return { ...prev, players: newPlayers, currentTrick: [], leadSuit: null, turnIndex: winner.playerId };
          });
          setClearingTrick(null);
        }, 850);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [gameState.currentTrick, soundEnabled, gameState.gameType]);

  const handleHumanPlay = (card: Card) => {
    if (gameState.turnIndex !== 0 || isProcessing || gameState.phase !== 'PLAYING' || clearingTrick || gameState.currentTrick.length >= 4) return;
    const hand = gameState.players[0].hand;
    const hasLeadSuit = hand.some(c => c.suit === gameState.leadSuit);
    if (gameState.gameType === 'HEARTS') {
      const isFirstTrick = gameState.players.reduce((sum, p) => sum + p.hand.length, 0) === 52;
      if (isFirstTrick && !gameState.leadSuit && card.id !== '2-CLUBS') { setMessage("Lead 2 of Clubs"); return; }
      if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) { setMessage(`Must follow ${gameState.leadSuit}`); return; }
    } else {
      if (gameState.leadSuit && hasLeadSuit && card.suit !== gameState.leadSuit) { setMessage(`Must follow ${gameState.leadSuit}`); return; }
      if (!gameState.leadSuit && card.suit === 'SPADES' && !gameState.spadesBroken && !hand.every(c => c.suit === 'SPADES')) { setMessage("Spades not broken"); return; }
    }
    playCard(0, card.id);
    setMessage("");
  };

  const handSpacing = useMemo(() => {
    const count = gameState.players[0].hand.length;
    if (count <= 1) return 0;
    const containerWidth = Math.min(window.innerWidth, 550) - 32;
    const cardWidth = 93; 
    const availableWidth = containerWidth - cardWidth;
    const spacing = availableWidth / (count - 1);
    return Math.max(12, Math.min(45, spacing));
  }, [gameState.players[0].hand.length]);

  const showHint = async () => {
    if (gameState.phase !== 'PLAYING' || gameState.turnIndex !== 0 || isProcessing) return;
    setIsProcessing(true);
    let cardId = '';
    if (gameState.gameType === 'HEARTS') {
      const isFirstTrick = gameState.players.reduce((sum, p) => sum + p.hand.length, 0) === 52;
      cardId = await getBestMove(gameState.players[0].hand, gameState.currentTrick, gameState.leadSuit, gameState.heartsBroken, isFirstTrick, gameState.players[0].name, settings);
    } else {
      cardId = await getSpadesMove(gameState.players[0].hand, gameState.currentTrick, gameState.leadSuit, gameState.spadesBroken, gameState.players, 0);
    }
    setHintCardId(cardId);
    setIsProcessing(false);
  };

  const onDragStart = (e: any, cardId: string) => {
    if (dragInfo) return; 
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragInfo({ id: cardId, startY: y, currentY: y });
  };
  const onDragMove = (e: any) => {
    if (!dragInfo) return;
    const y = 'touches' in e ? e.touches[0].clientY : e.clientY;
    setDragInfo(prev => prev ? { ...prev, currentY: Math.min(prev.startY, y) } : null);
  };
  const onDragEnd = (card: Card) => {
    if (!dragInfo || dragInfo.id !== card.id) { setDragInfo(null); return; }
    const deltaY = dragInfo.startY - dragInfo.currentY;
    if (deltaY >= 50) { handleHumanPlay(card); }
    else if (deltaY < 5) { handleHumanPlay(card); }
    setDragInfo(null);
  };

  if (screen === 'HOME') {
    return (
      <div className="h-screen w-full flex flex-col felt-bg overflow-hidden relative">
        <div className="pt-[var(--safe-top)] px-6 pb-4">
           <h1 className="text-4xl font-black text-yellow-500 italic tracking-tighter drop-shadow-lg mb-0.5">CARD HUB</h1>
           <p className="text-white/40 text-[9px] font-black uppercase tracking-[0.4em]">Pro Offline Suite</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-24 grid grid-cols-2 gap-4 content-start pt-4">
           {GAMES_LIST.map(game => (
             <div key={game.id} onClick={() => { if (game.available) { setGameState(p => ({...p, gameType: game.id.toUpperCase() as GameType, players: INITIAL_PLAYERS.map(pl => ({...pl, score: 0, tricksWon: 0})), teamScores:[0,0], teamBags:[0,0], roundNumber: 1, phase: 'DEALING'})); setScreen('GAME'); } }}
               className={`relative aspect-[4/5] rounded-[2rem] p-5 flex flex-col items-center justify-between border-2 transition-all duration-300 ${game.available ? 'bg-black/40 border-white/10 active:scale-95 shadow-2xl cursor-pointer' : 'bg-black/60 border-white/5 opacity-50 grayscale cursor-not-allowed'}`}
             >
                <div className={`w-14 h-14 ${game.color} rounded-2xl flex items-center justify-center text-3xl shadow-lg border border-white/20 transform rotate-[-5deg]`}>{game.icon}</div>
                <div className="flex flex-col items-center">
                   <span className="text-lg font-black uppercase tracking-tight text-white mb-1">{game.name}</span>
                   <span className={`text-[8px] font-black uppercase tracking-widest ${game.available ? 'text-green-500' : 'text-yellow-500/80'}`}>{game.available ? 'Play Now' : 'Coming Soon'}</span>
                </div>
             </div>
           ))}
        </div>
      </div>
    );
  }

  const totalHandWidth = (gameState.players[0].hand.length - 1) * handSpacing + 93;
  const startX = (window.innerWidth - totalHandWidth) / 2;

  return (
    <div className="h-screen w-full flex flex-col felt-bg select-none relative overflow-hidden" onMouseMove={onDragMove} onMouseUp={() => dragInfo && setDragInfo(null)} onTouchMove={onDragMove} onTouchEnd={() => dragInfo && setDragInfo(null)}>
      <div className="flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 pb-2 backdrop-blur-md border-b border-white/5 h-16 shadow-2xl">
        <div className="flex items-center gap-1">
          <button onClick={() => setScreen('HOME')} className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center text-lg active:scale-90 transition-transform">🏠</button>
        </div>
        <div className="flex-1 px-4 flex justify-center">
          {gameState.gameType === 'SPADES' ? (
            <div className="flex items-center bg-black/60 rounded-lg overflow-hidden border border-white/10 h-10 w-full max-w-[200px] shadow-lg">
              <div className="flex-1 bg-blue-700 h-full flex flex-col items-center justify-center leading-none px-2 border-r border-white/5">
                <span className="text-[14px] font-black text-white">{gameState.teamScores[0]}</span>
                <span className="text-[7px] font-black text-white/50 uppercase tracking-tighter">Blue</span>
              </div>
              <div className="w-10 h-full bg-black/40 flex items-center justify-center text-[10px] font-black text-yellow-500/80 italic">500</div>
              <div className="flex-1 bg-rose-700 h-full flex flex-col items-center justify-center leading-none px-2 border-l border-white/5">
                <span className="text-[14px] font-black text-white">{gameState.teamScores[1]}</span>
                <span className="text-[7px] font-black text-white/50 uppercase tracking-tighter">Red</span>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <span className="text-[8px] text-white/40 font-black uppercase tracking-widest block leading-none mb-1">Round</span>
              <span className="text-3xl font-black italic text-yellow-500 drop-shadow-md leading-none">{gameState.roundNumber}</span>
            </div>
          )}
        </div>
        <button onClick={() => setSoundEnabled(!soundEnabled)} className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center text-lg">{soundEnabled ? '🔊' : '🔇'}</button>
      </div>

      <div className="flex-1 relative">
        <Avatar player={gameState.players[2]} pos="top-4 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 2} isWinner={clearingTrick?.winnerId === 2} gameType={gameState.gameType} />
        <Avatar player={gameState.players[3]} pos="top-[30%] left-2" active={gameState.turnIndex === 3} isWinner={clearingTrick?.winnerId === 3} gameType={gameState.gameType} />
        <Avatar player={gameState.players[1]} pos="top-[30%] right-2" active={gameState.turnIndex === 1} isWinner={clearingTrick?.winnerId === 1} gameType={gameState.gameType} />
        <Avatar player={gameState.players[0]} pos="bottom-4 left-1/2 -translate-x-1/2" active={gameState.turnIndex === 0} isWinner={clearingTrick?.winnerId === 0} gameType={gameState.gameType} />

        {gameState.phase === 'PLAYING' && gameState.turnIndex === 0 && (
          <>
            <div className="absolute bottom-[160px] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
               <div className="w-8 h-1 bg-yellow-400 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.5)]"></div>
               <div className="text-[12px] font-black uppercase tracking-[0.3em] text-yellow-400 drop-shadow-lg">Your Turn</div>
            </div>
            <button onClick={showHint} disabled={isProcessing} 
              className="absolute bottom-4 left-6 flex flex-col items-center gap-1 bg-black/50 p-3 rounded-2xl border border-white/10 active:scale-95 transition-all z-50 disabled:opacity-30 disabled:grayscale shadow-xl hover:bg-yellow-500/20 hover:border-yellow-500/50"
            >
              <span className="text-2xl">💡</span>
              <span className="text-[8px] font-black uppercase tracking-widest text-yellow-400">Hint</span>
            </button>
          </>
        )}

        <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[18rem] h-[18rem] flex items-center justify-center z-20 pointer-events-none">
          {gameState.currentTrick.map((t, idx) => {
             const spread = 45; 
             const offsets = [{ x: 0, y: spread, rot: '0deg' }, { x: spread, y: 0, rot: '15deg' }, { x: 0, y: -spread, rot: '-5deg' }, { x: -spread, y: 0, rot: '-15deg' }];
             const off = offsets[t.playerId];
             const winDir = [{ x: 0, y: 400 }, { x: 300, y: 0 }, { x: 0, y: -400 }, { x: -300, y: 0 }][clearingTrick?.winnerId ?? 0];
             return (
               <div key={idx} className={`absolute transition-all animate-play ${clearingTrick ? 'animate-clear' : ''}`} style={{ '--play-x': `${off.x}px`, '--play-y': `${off.y}px`, '--play-rot': off.rot, '--play-start': 'scale(0.5)', '--clear-x': `${winDir.x}px`, '--clear-y': `${winDir.y}px`, zIndex: 10 + idx } as any}>
                 <CardView card={t.card} size="md" />
               </div>
             );
          })}
        </div>

        <div className="absolute top-[20%] w-full flex flex-col items-center z-50 px-10">
           {message && <div className="bg-yellow-400 text-black px-6 py-2 rounded-full text-[11px] font-black uppercase shadow-2xl animate-fan tracking-widest border-2 border-white/30">{message}</div>}
           {gameState.phase === 'BIDDING' && gameState.turnIndex === 0 && (
             <div className="mt-8 grid grid-cols-5 gap-3 bg-black/80 p-5 rounded-[2.5rem] border border-white/10 backdrop-blur-2xl pointer-events-auto shadow-2xl">
               {[1,2,3,4,5,6,7,8,9,10].map(b => (
                 <button key={b} onClick={() => handleSpadesBid(b)} className="w-12 h-12 rounded-2xl bg-white/5 hover:bg-yellow-500 hover:text-black font-black text-xl transition-all border border-white/5 active:scale-90 shadow-inner">{b}</button>
               ))}
             </div>
           )}
        </div>
      </div>

      <div className={`relative h-56 w-full flex flex-col items-center justify-end pb-[calc(1rem+var(--safe-bottom))] z-40 bg-gradient-to-t from-black/80 to-transparent`}>
        <div className="relative w-full overflow-visible flex-1">
           {gameState.players[0].hand.map((card, idx, arr) => {
             const tx = (idx * handSpacing) + startX;
             const centerIdx = (arr.length - 1) / 2;
             const distFromCenter = Math.abs(idx - centerIdx);
             const ty = distFromCenter * 1.8; 
             const rot = (idx - centerIdx) * 1.5; 
             
             const isDragging = dragInfo?.id === card.id;
             const dragOffset = isDragging ? dragInfo.currentY - dragInfo.startY : 0;
             const isHint = hintCardId === card.id;

             return (
                <div key={card.id} onMouseDown={(e) => onDragStart(e, card.id)} onTouchStart={(e) => onDragStart(e, card.id)} onMouseUp={() => onDragEnd(card)} onTouchEnd={() => onDragEnd(card)}
                  className={`absolute card-fan-item animate-deal cursor-grab active:cursor-grabbing ${isDragging ? 'z-[500] transition-none' : ''}`}
                  style={{ transform: `translate3d(${tx}px, ${ty + dragOffset}px, 0) rotate(${rot}deg) scale(${isDragging ? 1.15 : 1})`, zIndex: isDragging ? 500 : 100 + idx, animationDelay: `${idx * 0.015}s` }}
                >
                  <CardView card={card} size="lg" highlighted={isDragging && Math.abs(dragOffset) >= 50} hint={isHint} />
                  {isDragging && Math.abs(dragOffset) >= 50 && (
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-yellow-400 text-black text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest whitespace-nowrap animate-bounce shadow-2xl ring-2 ring-white/40 z-[600] border border-black/10">
                      Play
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
               {gameState.gameType === 'SPADES' ? (
                 <div className="space-y-4">
                    <div className="bg-blue-600/20 p-5 rounded-[2rem] border-2 border-blue-500/50 flex justify-between items-center shadow-2xl backdrop-blur-lg">
                       <div className="text-left"><div className="text-[11px] font-black text-blue-400 uppercase tracking-[0.25em] mb-1">Team Blue</div><div className="text-4xl font-black italic text-white drop-shadow-md">{gameState.teamScores[0]}</div></div>
                       <div className="text-right flex flex-col items-end">
                         <span className="text-[11px] text-white/50 font-black uppercase">Bags: {gameState.teamBags[0]}/10</span>
                       </div>
                    </div>
                    <div className="bg-rose-600/20 p-5 rounded-[2rem] border-2 border-rose-500/50 flex justify-between items-center shadow-2xl backdrop-blur-lg">
                       <div className="text-left"><div className="text-[11px] font-black text-rose-400 uppercase tracking-[0.25em] mb-1">Team Red</div><div className="text-4xl font-black italic text-white drop-shadow-md">{gameState.teamScores[1]}</div></div>
                       <div className="text-right flex flex-col items-end">
                         <span className="text-[11px] text-white/50 font-black uppercase">Bags: {gameState.teamBags[1]}/10</span>
                       </div>
                    </div>
                 </div>
               ) : gameState.players.map(p => (
                 <div key={p.id} className="flex justify-between items-center bg-white/5 p-4 rounded-3xl border border-white/10 shadow-inner">
                    <div className="flex items-center gap-4"><span className="text-4xl drop-shadow-lg">{p.avatar}</span><div className="flex flex-col items-start text-left"><span className="font-black text-sm uppercase tracking-tight">{p.name}</span><span className="text-[10px] text-white/30 font-bold uppercase tracking-tighter">Total Score: {p.score}</span></div></div>
                    <div className="text-right text-3xl font-black italic text-yellow-500 drop-shadow-md">+{p.currentRoundScore}</div>
                 </div>
               ))}
            </div>
            <button onClick={() => { if (gameState.phase === 'GAME_OVER') setScreen('HOME'); else { setGameState(p => ({...p, phase: 'DEALING', roundNumber: p.roundNumber + 1})); } }} 
              className="w-full py-6 bg-green-600 rounded-[2.5rem] font-black text-2xl uppercase active:scale-95 transition-all shadow-2xl border-b-8 border-green-800 tracking-[0.1em] hover:brightness-110">CONTINUE</button>
        </Overlay>
      )}
    </div>
  );
}
