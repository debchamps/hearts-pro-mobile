
import React, { memo } from 'react';
import { Card, GamePhase, GameType, Player, HistoryItem } from './types';
import { SUIT_COLORS, SUIT_SYMBOLS } from './constants';

export const Overlay = memo(({ title, subtitle, children, fullWidth = false }: { title: string, subtitle: string, children?: React.ReactNode, fullWidth?: boolean }) => (
  <div className="absolute inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 text-center animate-play">
     <h2 className="text-5xl font-black text-yellow-500 italic mb-1 tracking-tighter drop-shadow-2xl uppercase">{title}</h2>
     <p className="text-white/30 text-[9px] font-black uppercase tracking-[0.5em] mb-8">{subtitle}</p>
     <div className={`w-full ${fullWidth ? 'max-w-xl' : 'max-w-sm'}`}>{children}</div>
  </div>
));

export const CardView = memo(({ card, size = 'md', inactive = false, highlighted = false, hint = false }: { card: Card, size?: 'sm' | 'md' | 'lg', inactive?: boolean, highlighted?: boolean, hint?: boolean }) => {
  if (!card) return null;
  const dims = size === 'sm' ? 'w-[2.85rem] h-[3.8rem] p-1' : size === 'md' ? 'w-[4.75rem] h-[6.33rem] p-2' : 'w-[5.51rem] h-[7.41rem] p-2';
  const rankStyle = size === 'sm' ? 'text-[9px]' : size === 'md' ? 'text-md' : 'text-lg';
  const cornerSymStyle = size === 'sm' ? 'text-[5px]' : size === 'md' ? 'text-[9px]' : 'text-xs';
  const brSymStyle = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-lg' : 'text-xl';
  const hugeIconStyle = size === 'sm' ? 'text-2xl' : size === 'md' ? 'text-5xl' : 'text-6xl';
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

export const Avatar = memo(({ player, pos, active, isWinner = false, gameType = 'HEARTS', phase }: { player: Player, pos: string, active: boolean, isWinner?: boolean, gameType?: GameType, phase: GamePhase }) => {
  const isSpades = gameType === 'SPADES';
  const isTeamBlue = isSpades && player.teamId === 0;
  
  const teamColor = isSpades ? (isTeamBlue ? 'border-blue-500' : 'border-rose-500') : 'border-yellow-500/40';
  const teamGlow = isSpades ? (isTeamBlue ? 'shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'shadow-[0_0_20px_rgba(244,63,94,0.4)]') : 'shadow-[0_0_15px_rgba(0,0,0,0.3)]';
  const teamBg = isSpades ? (isTeamBlue ? 'bg-blue-600/20' : 'bg-rose-600/20') : 'bg-black/60';
  const badgeColor = isSpades ? (isTeamBlue ? 'bg-blue-600' : 'bg-rose-600') : 'bg-yellow-600';

  const showBiddingStatus = isSpades && phase === 'BIDDING' && active;
  const hasBidAlready = isSpades && phase === 'BIDDING' && player.bid !== undefined;

  return (
    <div className={`absolute ${pos} flex flex-col items-center transition-all duration-500 z-10 ${active ? 'opacity-100 scale-110' : 'opacity-80 scale-95'} ${isWinner ? 'scale-125' : ''}`}>
      <div className={`relative w-16 h-16 rounded-3xl flex items-center justify-center text-4xl shadow-2xl border-4 transition-all duration-500 backdrop-blur-md ${isWinner ? 'winner-glow bg-yellow-400 border-yellow-200' : `${teamBg} ${teamColor} ${teamGlow}`} ${active ? 'ring-4 ring-yellow-400/50' : ''}`}>
        {player.avatar}
        
        {showBiddingStatus && !hasBidAlready && (
           <div className="absolute -bottom-2 bg-yellow-400 text-black px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest animate-pulse border border-black/20 shadow-lg whitespace-nowrap">Thinking...</div>
        )}
        
        {isSpades && player.bid !== undefined && (
           <div className={`absolute -right-3 -bottom-3 ${badgeColor} text-white w-10 h-10 rounded-full flex flex-col items-center justify-center border-2 border-white shadow-2xl animate-deal transform rotate-12 z-30`}>
              <span className="text-[7px] font-black uppercase leading-none opacity-60">BID</span>
              <span className="text-lg font-black leading-none">{player.bid}</span>
           </div>
        )}
      </div>
      
      <div className="mt-3 flex flex-col items-center pointer-events-none">
        <div className={`flex items-center h-7 rounded-lg overflow-hidden border border-white/20 shadow-xl backdrop-blur-md`}>
          <div className={`${badgeColor} px-3 h-full flex items-center justify-center text-[13px] font-black text-white min-w-[32px]`}>
            {gameType === 'HEARTS' ? (player.score + (player.currentRoundScore || 0)) : (player.tricksWon || 0)}
          </div>
          <div className="bg-black/80 px-2 h-full flex items-center justify-center text-[9px] font-black text-white/40 uppercase tracking-tighter min-w-[28px]">
            {gameType === 'HEARTS' ? 'pts' : (player.bid !== undefined ? `/${player.bid}` : '/--')}
          </div>
        </div>
        {!isSpades && <span className="text-[10px] font-black uppercase text-white/50 tracking-[0.15em] mt-1 drop-shadow-md">{player.name}</span>}
      </div>
    </div>
  );
});

export const HistoryModal = memo(({ history, players, onClose }: { history: HistoryItem[], players: Player[], onClose: () => void }) => {
  return (
    <div className="absolute inset-0 z-[200] bg-black/90 backdrop-blur-2xl flex flex-col animate-play pt-[var(--safe-top)]">
      <div className="p-6 flex justify-between items-center border-b border-white/10">
        <div>
          <h2 className="text-3xl font-black italic text-yellow-500 uppercase">Trick History</h2>
          <p className="text-[8px] text-white/30 uppercase tracking-[0.3em]">Round Analysis</p>
        </div>
        <button onClick={onClose} className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-2xl">✕</button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {history.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-30">
            <span className="text-6xl mb-4">📭</span>
            <p className="font-black uppercase tracking-widest text-xs">No tricks played yet</p>
          </div>
        ) : (
          history.map((item, idx) => (
            <div key={idx} className="bg-white/5 rounded-[2rem] p-4 border border-white/10 relative overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Trick {idx + 1}</span>
                <span className="text-[10px] font-black text-yellow-500/80 uppercase tracking-widest">
                  Winner: {players[item.winnerId].avatar} {players[item.winnerId].name}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {item.trick.map((t, tIdx) => (
                  <div key={tIdx} className="flex flex-col items-center gap-2">
                    <div className="relative">
                      <CardView card={t.card} size="sm" />
                      {t.playerId === item.winnerId && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center text-[10px] border border-white shadow-lg animate-bounce">👑</div>
                      )}
                    </div>
                    <span className="text-[10px] opacity-40">{players[t.playerId].avatar}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export const HowToPlayModal = memo(({ gameType, onClose }: { gameType: GameType, onClose: () => void }) => {
  const isHearts = gameType === 'HEARTS';
  
  return (
    <div className="absolute inset-0 z-[250] bg-black/95 backdrop-blur-3xl flex flex-col animate-play pt-[var(--safe-top)]">
      <div className="p-6 flex justify-between items-center border-b border-white/10">
        <div>
          <h2 className="text-3xl font-black italic text-yellow-500 uppercase">How to Play</h2>
          <p className="text-[8px] text-white/30 uppercase tracking-[0.3em]">{gameType} Guide</p>
        </div>
        <button onClick={onClose} className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-2xl">✕</button>
      </div>
      
      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        <section>
          <h3 className="text-yellow-500 font-black uppercase text-sm tracking-widest mb-3">Objective</h3>
          <p className="text-white/80 text-sm leading-relaxed">
            {isHearts 
              ? "The goal of Hearts is to finish with the lowest score. The game ends when a player reaches 100 points."
              : "Spades is a trick-taking game where teams bid on how many tricks they can win. Reach 500 points to win!"}
          </p>
        </section>

        <section>
          <h3 className="text-yellow-500 font-black uppercase text-sm tracking-widest mb-3">Card Points</h3>
          <div className="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-2">
            {isHearts ? (
              <>
                <div className="flex justify-between text-sm"><span className="text-white/60">Each Heart card</span><span className="font-bold text-red-500">1 Point</span></div>
                <div className="flex justify-between text-sm"><span className="text-white/60">Queen of Spades</span><span className="font-bold text-red-500">13 Points</span></div>
                <div className="flex justify-between text-sm"><span className="text-white/60">Shooting the Moon</span><span className="font-bold text-green-500">0 Pts (Others +26)</span></div>
              </>
            ) : (
              <>
                <div className="flex justify-between text-sm"><span className="text-white/60">Successful Bid</span><span className="font-bold text-green-500">Bid × 10</span></div>
                <div className="flex justify-between text-sm"><span className="text-white/60">Extra Tricks (Bags)</span><span className="font-bold text-yellow-500">1 Pt each</span></div>
                <div className="flex justify-between text-sm"><span className="text-white/60">10 Bags Penalty</span><span className="font-bold text-red-500">-100 Points</span></div>
                <div className="flex justify-between text-sm"><span className="text-white/60">Failed Bid</span><span className="font-bold text-red-500">-(Bid × 10)</span></div>
              </>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-yellow-500 font-black uppercase text-sm tracking-widest mb-3">Rules & Gameplay</h3>
          <ul className="space-y-4">
            {isHearts ? (
              <>
                <li className="flex gap-3"><span className="text-yellow-500">●</span><p className="text-xs text-white/60 leading-relaxed"><strong className="text-white uppercase block mb-1">The Lead</strong>The player with the 2 of Clubs leads the first trick.</p></li>
                <li className="flex gap-3"><span className="text-yellow-500">●</span><p className="text-xs text-white/60 leading-relaxed"><strong className="text-white uppercase block mb-1">Follow Suit</strong>You must follow the lead suit if you have it. If not, you can discard any card.</p></li>
                <li className="flex gap-3"><span className="text-yellow-500">●</span><p className="text-xs text-white/60 leading-relaxed"><strong className="text-white uppercase block mb-1">Breaking Hearts</strong>You cannot lead with Hearts until a Heart has been discarded on a previous trick.</p></li>
              </>
            ) : (
              <>
                <li className="flex gap-3"><span className="text-yellow-500">●</span><p className="text-xs text-white/60 leading-relaxed"><strong className="text-white uppercase block mb-1">Bidding</strong>Predict how many tricks your team can win. Your partner's bid is added to yours.</p></li>
                <li className="flex gap-3"><span className="text-yellow-500">●</span><p className="text-xs text-white/60 leading-relaxed"><strong className="text-white uppercase block mb-1">Spades are Trump</strong>Spades can beat any other suit. They are always the highest priority cards.</p></li>
                <li className="flex gap-3"><span className="text-yellow-500">●</span><p className="text-xs text-white/60 leading-relaxed"><strong className="text-white uppercase block mb-1">Nil Bid</strong>Bid 0 for a 100 point bonus if you win NO tricks. It's high risk, high reward!</p></li>
              </>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
});
