
import React, { memo, useRef, useState, useCallback } from 'react';
import { Card, GamePhase, GameType, Player, HistoryItem, SpadesRoundSummary, CallbreakRoundSummary, PlayerEmotion } from './types';
import { SUIT_COLORS, SUIT_SYMBOLS } from './constants';

export const Overlay = memo(({ title, subtitle, children, fullWidth = false }: { title: string, subtitle: string, children?: React.ReactNode, fullWidth?: boolean }) => (
  <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
    <div className={`bg-neutral-900 border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col items-center justify-center p-8 text-center animate-play w-[90%] max-h-[85vh] overflow-y-auto ${fullWidth ? 'max-w-xl' : 'max-w-sm'}`}>
       <h2 className="text-4xl font-black text-yellow-500 italic mb-1 tracking-tighter drop-shadow-2xl uppercase leading-tight">{title}</h2>
       <p className="text-white/30 text-[8px] font-black uppercase tracking-[0.4em] mb-6">{subtitle}</p>
       <div className="w-full">{children}</div>
    </div>
  </div>
));

export const CardView = memo(({ card, size = 'md', inactive = false, highlighted = false, hint = false }: { card: Card, size?: 'sm' | 'md' | 'lg', inactive?: boolean, highlighted?: boolean, hint?: boolean }) => {
  if (!card) return null;
  const dims = size === 'sm' ? 'w-[2.85rem] h-[3.8rem]' : size === 'md' ? 'w-[4.75rem] h-[6.33rem]' : 'w-[5.51rem] h-[7.41rem]';
  const rankStyle = size === 'sm' ? 'text-[11px]' : size === 'md' ? 'text-lg' : 'text-xl';
  const cornerSymStyle = size === 'sm' ? 'text-[7px]' : size === 'md' ? 'text-[10px]' : 'text-xs';
  const brSymStyle = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-lg' : 'text-xl';
  const hugeIconStyle = size === 'sm' ? 'text-2xl' : size === 'md' ? 'text-5xl' : 'text-6xl';
  
  const showRing = highlighted || hint;
  const ringColor = hint ? 'ring-cyan-400 shadow-[0_0_35px_rgba(34,211,238,0.9)]' : 'ring-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.6)]';

  const cornerTop = size === 'sm' ? 'top-0.5' : 'top-1';
  const cornerLeft = size === 'sm' ? 'left-0.5' : 'left-1';

  return (
    <div className={`${dims} bg-white rounded-lg card-shadow relative overflow-hidden transition-all duration-300 ${SUIT_COLORS[card.suit] || 'text-black'} ${showRing ? `ring-4 ${ringColor}` : ''} ${hint ? 'animate-pulse' : ''} ${inactive ? 'grayscale brightness-[0.7] contrast-[0.9]' : 'opacity-100'}`}>
      <div className={`absolute ${cornerTop} ${cornerLeft} flex flex-col items-center leading-none z-10`}>
        <div className={`font-black tracking-tighter ${rankStyle}`}>{card.rank}</div>
        <div className={`${cornerSymStyle} -mt-0.5`}>{SUIT_SYMBOLS[card.suit]}</div>
      </div>
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.08] ${hugeIconStyle} leading-none pointer-events-none rotate-[-8deg]`}>{SUIT_SYMBOLS[card.suit]}</div>
      <div className={`absolute bottom-1 right-1 leading-none z-10 ${brSymStyle} pointer-events-none`}>{SUIT_SYMBOLS[card.suit]}</div>
      {inactive && <div className="absolute inset-0 bg-black/40 z-20 pointer-events-none" />}
    </div>
  );
});

export const Avatar = memo(({ player, pos, active, isWinner = false, gameType = 'HEARTS', phase, onClick, emojisEnabled = true }: { player: Player, pos: string, active: boolean, isWinner?: boolean, gameType?: GameType, phase: GamePhase, onClick?: () => void, emojisEnabled?: boolean }) => {
  const isSpades = gameType === 'SPADES' || gameType === 'CALLBREAK';
  const isTeamBlue = gameType === 'SPADES' && player.teamId === 0;
  
  const teamColor = gameType === 'CALLBREAK' ? 'border-purple-500' : isSpades ? (isTeamBlue ? 'border-blue-500' : 'border-rose-500') : 'border-yellow-500/40';
  const teamGlow = gameType === 'CALLBREAK' ? 'shadow-[0_0_15px_rgba(168,85,247,0.3)]' : isSpades ? (isTeamBlue ? 'shadow-[0_0_20px_rgba(37,99,235,0.4)]' : 'shadow-[0_0_20px_rgba(244,63,94,0.4)]') : 'shadow-[0_0_15px_rgba(0,0,0,0.3)]';
  const teamBg = gameType === 'CALLBREAK' ? 'bg-purple-900/40' : isSpades ? (isTeamBlue ? 'bg-blue-600/20' : 'bg-rose-600/20') : 'bg-black/60';
  const badgeColor = gameType === 'CALLBREAK' ? 'bg-purple-600' : isSpades ? (isTeamBlue ? 'bg-blue-600' : 'bg-rose-600') : 'bg-yellow-600';

  const showBiddingStatus = isSpades && phase === 'BIDDING' && active;
  const hasBidAlready = isSpades && phase === 'BIDDING' && player.bid !== undefined;

  const isCustomImage = player.avatar.startsWith('data:image');

  return (
    <div 
      className={`absolute ${pos} flex flex-col items-center transition-all duration-500 z-10 ${active ? 'opacity-100 scale-110' : 'opacity-80 scale-95'} ${isWinner ? 'scale-125' : ''} cursor-pointer active:scale-105`}
      onClick={onClick}
    >
      {/* Emotion Emoji Pop-up */}
      {emojisEnabled && player.emotion && (
        <div key={`${player.id}-${player.emotion}-${Date.now()}`} className="absolute -top-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none animate-emoji">
          <div className="text-4xl drop-shadow-2xl filter brightness-110">
            {player.emotion === 'HAPPY' ? '😊' : '😢'}
          </div>
        </div>
      )}

      <div className="relative">
        <div className={`relative w-16 h-16 rounded-3xl flex items-center justify-center text-4xl shadow-2xl border-4 transition-all duration-500 backdrop-blur-md overflow-hidden ${isWinner ? 'winner-glow bg-yellow-400 border-yellow-200' : `${teamBg} ${teamColor} ${teamGlow}`} ${active ? 'ring-4 ring-yellow-400/50' : ''}`}>
          {isCustomImage ? (
            <img src={player.avatar} className="w-full h-full object-cover" alt="Avatar" />
          ) : (
            player.avatar
          )}
          
          {showBiddingStatus && !hasBidAlready && (
            <div className="absolute -bottom-2 bg-yellow-400 text-black px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest animate-pulse border border-black/20 shadow-lg whitespace-nowrap">Thinking...</div>
          )}
        </div>
        
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
        {gameType !== 'CALLBREAK' && <span className="text-[10px] font-black uppercase text-white/50 tracking-[0.15em] mt-1 drop-shadow-md">{player.name}</span>}
      </div>
    </div>
  );
});

const PREDEFINED_AVATARS = ['👤', '🧔', '👩', '👱', '👴', '👵', '🤴', '👸', '🐱', '🐶', '🦊', '🐯', '🐸', '🤖', '👻', '👽', '🤠', '🤡', '🦄', '🐲'];

export const AvatarSelectionModal = memo(({ currentAvatar, onSelect, onClose }: { currentAvatar: string, onSelect: (avatar: string) => void, onClose: () => void }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCustomPhoto = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const aspect = img.width / img.height;
          let drawWidth, drawHeight, offsetX, offsetY;
          if (aspect > 1) {
            drawHeight = size;
            drawWidth = size * aspect;
            offsetX = -(drawWidth - size) / 2;
            offsetY = 0;
          } else {
            drawWidth = size;
            drawHeight = size / aspect;
            offsetY = -(drawHeight - size) / 2;
            offsetX = 0;
          }
          ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
          onSelect(canvas.toDataURL('image/jpeg', 0.8));
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [onSelect]);

  return (
    <div className="absolute inset-0 z-[300] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col w-[90%] max-w-sm animate-play overflow-hidden">
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-black italic text-yellow-500 uppercase tracking-tighter">Edit Avatar</h2>
            <p className="text-[8px] text-white/30 uppercase tracking-[0.3em]">Choose your identity</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-xl active:scale-90 transition-transform">✕</button>
        </div>

        <div className="p-6 grid grid-cols-5 gap-3">
          {PREDEFINED_AVATARS.map(icon => (
            <button 
              key={icon} 
              onClick={() => onSelect(icon)}
              className={`aspect-square rounded-2xl flex items-center justify-center text-2xl transition-all ${currentAvatar === icon ? 'bg-yellow-500 border-2 border-white scale-110 shadow-lg' : 'bg-white/5 hover:bg-white/10 border border-white/5 active:scale-95'}`}
            >
              {icon}
            </button>
          ))}
        </div>

        <div className="px-6 pb-8 flex flex-col gap-3">
          <input type="file" ref={fileInputRef} onChange={handleCustomPhoto} accept="image/*" className="hidden" />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full h-14 bg-indigo-600 rounded-2xl font-black text-xs uppercase tracking-widest border border-indigo-400 shadow-xl active:translate-y-1 transition-all flex items-center justify-center gap-2"
          >
            <span>📸</span> Choose Custom Photo
          </button>
          <p className="text-center text-[8px] text-white/20 uppercase font-bold tracking-widest">Select an icon or upload your own</p>
        </div>
      </div>
    </div>
  );
});

export const HistoryModal = memo(({ history, players, onClose }: { history: HistoryItem[], players: Player[], onClose: () => void }) => {
  return (
    <div className="absolute inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col w-[90%] max-w-lg max-h-[80vh] animate-play">
        <div className="p-6 flex justify-between items-center border-b border-white/10">
          <div>
            <h2 className="text-2xl font-black italic text-yellow-500 uppercase">Trick History</h2>
            <p className="text-[8px] text-white/30 uppercase tracking-[0.3em]">Round Analysis</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl active:scale-90 transition-transform">✕</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center opacity-30">
              <span className="text-5xl mb-4">📭</span>
              <p className="font-black uppercase tracking-widest text-[10px]">No tricks played yet</p>
            </div>
          ) : (
            history.map((item, idx) => (
              <div key={idx} className="bg-white/5 rounded-[1.5rem] p-4 border border-white/10">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[9px] font-black text-white/40 uppercase tracking-[0.2em]">Trick {idx + 1}</span>
                  <span className="text-[9px] font-black text-yellow-500/80 uppercase tracking-widest">
                    Won by {players[item.winnerId].avatar.length > 4 ? 'User' : players[item.winnerId].avatar}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {item.trick.map((t, tIdx) => (
                    <div key={tIdx} className="flex flex-col items-center gap-1">
                      <div className="relative">
                        <CardView card={t.card} size="sm" />
                        {t.playerId === item.winnerId && (
                          <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center text-[8px] border border-white shadow-lg">👑</div>
                        )}
                      </div>
                      <span className="text-[8px] opacity-30 font-bold uppercase">{players[t.playerId].name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

export const CallbreakScorecardModal = memo(({ history, players, onClose }: { history: CallbreakRoundSummary[], players: Player[], onClose: () => void }) => {
  return (
    <div className="absolute inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-purple-500/30 rounded-[2.5rem] shadow-2xl flex flex-col w-full max-w-xl max-h-[85vh] animate-play overflow-hidden">
        <div className="p-6 bg-purple-900/20 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-black italic text-yellow-500 uppercase">Callbreak Series</h2>
            <p className="text-[8px] text-white/30 uppercase tracking-[0.4em]">5-Round Performance Table</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-xl transition-all">✕</button>
        </div>

        <div className="flex-1 overflow-x-auto p-4">
          <table className="w-full text-center border-collapse">
            <thead>
              <tr className="text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">
                <th className="py-4 px-2 text-left">Round</th>
                {players.map(p => <th key={p.id} className="py-4 px-2">{p.avatar.length > 4 ? '👤' : p.avatar}<br/><span className="text-[7px] text-white/20">{p.name}</span></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[1, 2, 3, 4, 5].map(r => {
                const roundData = history.find(h => h.roundNumber === r);
                return (
                  <tr key={r} className="group hover:bg-white/5 transition-colors">
                    <td className="py-4 px-2 font-black text-white/30 text-lg text-left">#{r}</td>
                    {players.map(p => {
                      const pScore = roundData?.scores.find(s => s.playerId === p.id);
                      return (
                        <td key={p.id} className="py-4 px-2">
                           {pScore ? (
                             <div className="flex flex-col">
                               <span className={`text-xl font-black ${pScore.scoreChange >= 0 ? 'text-green-500' : 'text-rose-500'}`}>{pScore.scoreChange.toFixed(1)}</span>
                               <span className="text-[7px] font-black text-white/20 uppercase">T:{pScore.tricks}/B:{pScore.bid}</span>
                             </div>
                           ) : <span className="text-white/10 font-black">-</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-purple-900/10 border-t-2 border-purple-500/20">
                <td className="py-6 px-2 text-left font-black text-yellow-500 uppercase text-[10px] tracking-widest">Total</td>
                {players.map(p => (
                  <td key={p.id} className="py-6 px-2">
                    <span className="text-3xl font-black italic text-white">{p.score.toFixed(1)}</span>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
});

export const ScorecardModal = memo(({ history, currentScores, currentBags, onClose }: { history: SpadesRoundSummary[], currentScores: [number, number], currentBags: [number, number], onClose: () => void }) => {
  return (
    <div className="absolute inset-0 z-[200] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-white/20 rounded-[2.5rem] shadow-2xl flex flex-col w-full max-w-xl max-h-[85vh] animate-play overflow-hidden">
        <div className="p-6 bg-black/40 border-b border-white/10 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-black italic text-yellow-500 uppercase tracking-tighter">Scorecard</h2>
            <p className="text-[8px] text-white/30 uppercase tracking-[0.4em]">Team Pro Performance</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white/5 hover:bg-white/10 rounded-xl flex items-center justify-center text-xl transition-all active:scale-90">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[9px] font-black text-white/40 uppercase tracking-widest border-b border-white/5">
                <th className="py-4 px-2 w-16">Round</th>
                <th className="py-4 px-2 text-blue-500">Team Blue</th>
                <th className="py-4 px-2 text-rose-500">Team Red</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {history.map((round) => (
                <tr key={round.roundNumber} className="group hover:bg-white/5 transition-colors">
                  <td className="py-4 px-2 font-black italic text-white/30 text-lg">#{round.roundNumber}</td>
                  <td className="py-4 px-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-white">{round.team0.scoreChange > 0 ? `+${round.team0.scoreChange}` : round.team0.scoreChange}</span>
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-tighter">({round.team0.tricks}/{round.team0.bid})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {round.team0.bagPenalty && <span className="bg-red-500/20 text-red-500 text-[8px] font-black px-1.5 py-0.5 rounded border border-red-500/30 uppercase">Bag Penalty!</span>}
                        {round.team0.nilResults.map((nr, i) => (
                          <span key={i} className={`${nr.success ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-red-500/20 text-red-500 border-red-500/30'} text-[8px] font-black px-1.5 py-0.5 rounded border uppercase`}>
                            {nr.success ? 'NIL Success' : 'NIL FAILED!'}
                          </span>
                        ))}
                        <span className="text-[8px] font-black text-blue-400 opacity-60 uppercase">Bags: +{round.team0.bags}</span>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-2">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-white">{round.team1.scoreChange > 0 ? `+${round.team1.scoreChange}` : round.team1.scoreChange}</span>
                        <span className="text-[10px] font-black text-white/20 uppercase tracking-tighter">({round.team1.tricks}/{round.team1.bid})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {round.team1.bagPenalty && <span className="bg-red-500/20 text-red-500 text-[8px] font-black px-1.5 py-0.5 rounded border border-red-500/30 uppercase">Bag Penalty!</span>}
                        {round.team1.nilResults.map((nr, i) => (
                          <span key={i} className={`${nr.success ? 'bg-green-500/20 text-green-500 border-green-500/30' : 'bg-red-500/20 text-red-500 border-red-500/30'} text-[8px] font-black px-1.5 py-0.5 rounded border uppercase`}>
                            {nr.success ? 'NIL Success' : 'NIL FAILED!'}
                          </span>
                        ))}
                        <span className="text-[8px] font-black text-rose-400 opacity-60 uppercase">Bags: +{round.team1.bags}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-20 text-center opacity-20 font-black uppercase tracking-[0.2em] text-xs">No rounds completed</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-6 bg-black/60 border-t border-white/10 grid grid-cols-2 gap-6">
          <div className="flex flex-col items-start">
             <span className="text-[9px] font-black text-blue-500 uppercase tracking-[0.2em] mb-1">Total Blue</span>
             <div className="flex items-baseline gap-2">
               <span className="text-3xl font-black italic text-white">{currentScores[0]}</span>
               <span className="text-[10px] font-black text-white/30 uppercase tracking-tighter">{currentBags[0]} Bags</span>
             </div>
          </div>
          <div className="flex flex-col items-end">
             <span className="text-[9px] font-black text-rose-500 uppercase tracking-[0.2em] mb-1">Total Red</span>
             <div className="flex items-baseline gap-2">
               <span className="text-3xl font-black italic text-white">{currentScores[1]}</span>
               <span className="text-[10px] font-black text-white/30 uppercase tracking-tighter">{currentBags[1]} Bags</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export const HowToPlayModal = memo(({ gameType, onClose }: { gameType: GameType, onClose: () => void }) => {
  const isHearts = gameType === 'HEARTS';
  
  return (
    <div className="absolute inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-neutral-900 border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col w-[90%] max-w-lg max-h-[80vh] animate-play">
        <div className="p-6 flex justify-between items-center border-b border-white/10">
          <div>
            <h2 className="text-2xl font-black italic text-yellow-500 uppercase">How to Play</h2>
            <p className="text-[8px] text-white/30 uppercase tracking-[0.3em]">{gameType} Guide</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-xl active:scale-90 transition-transform">✕</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <section>
            <h3 className="text-yellow-500 font-black uppercase text-[11px] tracking-widest mb-2">Objective</h3>
            <p className="text-white/70 text-xs leading-relaxed font-medium">
              {isHearts 
                ? "The goal of Hearts is to finish with the lowest score. The game ends when a player reaches 100 points."
                : "Spades is a trick-taking game where teams bid on how many tricks they can win. Reach 500 points to win!"}
            </p>
          </section>

          <section>
            <h3 className="text-yellow-500 font-black uppercase text-[11px] tracking-widest mb-2">Card Points</h3>
            <div className="bg-white/5 rounded-xl p-4 border border-white/5 space-y-2">
              {isHearts ? (
                <>
                  <div className="flex justify-between text-[11px]"><span className="text-white/50 uppercase font-black tracking-tighter">Hearts</span><span className="font-black text-red-500">1 PT Each</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/50 uppercase font-black tracking-tighter">Queen Spades</span><span className="font-black text-red-500">13 PTS</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/50 uppercase font-black tracking-tighter">Shoot Moon</span><span className="font-black text-green-500">0 PTS (+26 others)</span></div>
                </>
              ) : (
                <>
                  <div className="flex justify-between text-[11px]"><span className="text-white/50 uppercase font-black tracking-tighter">Target Met</span><span className="font-black text-green-500">BID × 10</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/50 uppercase font-black tracking-tighter">Bags</span><span className="font-black text-yellow-500">1 PT EACH</span></div>
                  <div className="flex justify-between text-[11px]"><span className="text-white/50 uppercase font-black tracking-tighter">10 Bags Penalty</span><span className="font-black text-red-500">-100 PTS</span></div>
                </>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-yellow-500 font-black uppercase text-[11px] tracking-widest mb-2">Quick Rules</h3>
            <ul className="space-y-3">
              {isHearts ? (
                <>
                  <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1" /><p className="text-[11px] text-white/60 leading-tight">2 of Clubs always leads the first trick.</p></li>
                  <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1" /><p className="text-[11px] text-white/60 leading-tight">Must follow lead suit if possible.</p></li>
                  <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1" /><p className="text-[11px] text-white/60 leading-tight">Cannot lead Hearts until they have been broken.</p></li>
                </>
              ) : (
                <>
                  <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1" /><p className="text-[11px] text-white/60 leading-tight">Predict tricks with your partner. Spades are always trump.</p></li>
                  <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1" /><p className="text-[11px] text-white/60 leading-tight">Highest Spade wins any trick it is played in.</p></li>
                  <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yellow-500 mt-1" /><p className="text-[11px] text-white/60 leading-tight">Nil bid bonus: +100 points for winning zero tricks.</p></li>
                </>
              )}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
});
