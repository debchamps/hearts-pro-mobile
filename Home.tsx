
import React, { useEffect, useState } from 'react';
import { GameType } from './types';
import { leaderboardService } from './services/leaderboardService';

const GAMES_LIST = [
  { id: 'hearts', name: 'Hearts', icon: '♥️', available: true, color: 'text-red-600' },
  { id: 'spades', name: 'Spades', icon: '♠️', available: true, color: 'text-indigo-900' },
  { id: 'callbreak', name: 'Callbreak', icon: '👑', available: true, color: 'text-purple-600' },
  { id: 'bray', name: 'Bray', icon: '🃏', available: false, color: 'text-amber-600' },
  { id: '29', name: '29', icon: '🎴', available: false, color: 'text-emerald-600' },
  { id: 'bridge', name: 'Bridge', icon: '🌉', available: false, color: 'text-cyan-600' },
];

export function Home({ onSelectGame, onResumeGame }: { onSelectGame: (type: GameType) => void, onResumeGame?: () => void }) {
  const [ranks, setRanks] = useState<Record<string, number>>({});

  useEffect(() => {
    // Sync any offline scores on launch
    leaderboardService.syncPendingScores();

    // Fetch initial ranks
    const fetchRanks = async () => {
      const r: Record<string, number> = {};
      for (const game of GAMES_LIST) {
        if (game.available) {
          const rank = await leaderboardService.getRank(game.id.toUpperCase() as GameType);
          if (rank) r[game.id] = rank;
        }
      }
      setRanks(r);
    };
    fetchRanks();
  }, []);

  return (
    <div className="h-screen w-full flex flex-col felt-bg overflow-hidden relative">
      <div className="pt-[var(--safe-top)] px-6 pb-4 flex justify-between items-end">
         <div>
            <h1 className="text-4xl font-black text-yellow-500 italic tracking-tighter drop-shadow-lg mb-0.5">CARD HUB</h1>
            <p className="text-white/40 text-[9px] font-black uppercase tracking-[0.4em]">Pro Offline Suite</p>
         </div>
         <div className="flex gap-2">
           {onResumeGame && (
              <button 
                onClick={onResumeGame}
                className="bg-yellow-500 text-black px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg border-b-4 border-yellow-700 active:translate-y-1 active:border-b-0 transition-all"
              >
                Resume Game
              </button>
           )}
         </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-24 grid grid-cols-2 gap-4 content-start pt-4">
         {GAMES_LIST.map((game, idx) => (
           <div key={game.id} className="relative">
              <div 
                onClick={() => { if (game.available) onSelectGame(game.id.toUpperCase() as GameType); }}
                className={`relative aspect-[4/5] rounded-[2rem] p-5 flex flex-col items-center justify-between border-2 transition-all duration-300 group ${game.available ? 'bg-black/40 border-white/10 active:scale-95 shadow-2xl cursor-pointer hover:border-white/30' : 'bg-black/60 border-white/5 opacity-50 grayscale cursor-not-allowed'}`}
              >
                  <div 
                    className={`w-10 h-10 bg-white rounded-xl flex items-center justify-center text-xl shadow-inner border border-white/40 animate-float-wiggle group-hover:scale-110 transition-transform ${game.color}`}
                    style={{ animationDelay: `${idx * 0.2}s` }}
                  >
                    {game.icon}
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-lg font-black uppercase tracking-tight text-white mb-1">{game.name}</span>
                    <span className={`text-[8px] font-black uppercase tracking-widest ${game.available ? 'text-green-500' : 'text-yellow-500/80'}`}>{game.available ? 'Play Now' : 'Coming Soon'}</span>
                  </div>
              </div>
              
              {game.available && (
                <div 
                  onClick={(e) => { e.stopPropagation(); leaderboardService.openLeaderboard(game.id.toUpperCase() as GameType); }}
                  className="absolute -top-2 -right-2 bg-neutral-900 border border-yellow-500/30 rounded-full px-2 py-1 shadow-xl flex items-center gap-1.5 cursor-pointer hover:scale-110 active:scale-95 transition-all z-10"
                >
                  <span className="text-[10px]">🏆</span>
                  <span className="text-[9px] font-black text-yellow-500 uppercase tracking-tighter">
                    {ranks[game.id] ? `#${ranks[game.id]}` : 'RANK'}
                  </span>
                </div>
              )}
           </div>
         ))}
      </div>
    </div>
  );
}
