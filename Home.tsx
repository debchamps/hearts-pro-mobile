
import React from 'react';
import { GameType } from './types';

const GAMES_LIST = [
  { id: 'hearts', name: 'Hearts', icon: '♥️', available: true, color: 'bg-red-500' },
  { id: 'spades', name: 'Spades', icon: '♠️', available: true, color: 'bg-indigo-600' },
  { id: 'callbreak', name: 'Callbreak', icon: '👑', available: true, color: 'bg-purple-600' },
  { id: 'bray', name: 'Bray', icon: '🃏', available: false, color: 'bg-amber-600' },
  { id: '29', name: '29', icon: '🎴', available: false, color: 'bg-emerald-600' },
  { id: 'bridge', name: 'Bridge', icon: '🌉', available: false, color: 'bg-cyan-600' },
];

export function Home({ onSelectGame, onResumeGame }: { onSelectGame: (type: GameType) => void, onResumeGame?: () => void }) {
  return (
    <div className="h-screen w-full flex flex-col felt-bg overflow-hidden relative">
      <div className="pt-[var(--safe-top)] px-6 pb-4 flex justify-between items-end">
         <div>
            <h1 className="text-4xl font-black text-yellow-500 italic tracking-tighter drop-shadow-lg mb-0.5">CARD HUB</h1>
            <p className="text-white/40 text-[9px] font-black uppercase tracking-[0.4em]">Pro Offline Suite</p>
         </div>
         {onResumeGame && (
            <button 
              onClick={onResumeGame}
              className="bg-yellow-500 text-black px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg animate-pulse border-b-4 border-yellow-700 active:translate-y-1 active:border-b-0 transition-all"
            >
              Resume Game
            </button>
         )}
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-24 grid grid-cols-2 gap-4 content-start pt-4">
         {GAMES_LIST.map(game => (
           <div key={game.id} onClick={() => { if (game.available) onSelectGame(game.id.toUpperCase() as GameType); }}
             className={`relative aspect-[4/5] rounded-[2rem] p-5 flex flex-col items-center justify-between border-2 transition-all duration-300 ${game.available ? 'bg-black/40 border-white/10 active:scale-95 shadow-2xl cursor-pointer hover:border-white/30' : 'bg-black/60 border-white/5 opacity-50 grayscale cursor-not-allowed'}`}
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
