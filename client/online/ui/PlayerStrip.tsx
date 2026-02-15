import React from 'react';
import { OnlinePlayerMeta } from '../types';

export function PlayerStrip({ players, activeSeat }: { players: OnlinePlayerMeta[]; activeSeat: number }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {players.map((p) => (
        <div
          key={p.seat}
          className={`rounded-xl border px-2 py-1 text-[10px] uppercase tracking-wide ${
            p.seat === activeSeat ? 'border-yellow-400 bg-yellow-500/20' : 'border-white/10 bg-black/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-black text-white">{p.name}</span>
            <span className="text-white/60">{p.rankBadge}</span>
          </div>
          <div className="flex items-center justify-between text-white/70">
            <span>Ping {p.pingMs}ms</span>
            <span>{p.coins}c</span>
          </div>
        </div>
      ))}
    </div>
  );
}
