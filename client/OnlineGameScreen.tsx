import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, CardView } from '../SharedComponents';
import { GameType, Player } from '../types';
import { MultiplayerService } from './online/network/multiplayerService';
import { MultiplayerGameState } from './online/types';
import { TurnTimer } from './online/ui/TurnTimer';
import { getLocalPlayerName } from './online/network/playerName';

export function OnlineGameScreen({ gameType, onExit }: { gameType: GameType; onExit: () => void }) {
  const serviceRef = useRef<MultiplayerService>(new MultiplayerService());
  const [state, setState] = useState<MultiplayerGameState | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<string>('');
  const [renderTrick, setRenderTrick] = useState<Array<{ seat: number; card: any }>>([]);
  const [clearingTrickWinner, setClearingTrickWinner] = useState<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        setLoading(true);
        const created = await serviceRef.current.createMatch(gameType, getLocalPlayerName());
        if (mounted) setState(created);
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();
    return () => {
      mounted = false;
    };
  }, [gameType]);

  useEffect(() => {
    if (!state || state.status === 'COMPLETED') return;
    const timer = setInterval(async () => {
      try {
        const next = await serviceRef.current.pollDelta();
        if (next) setState({ ...next });
      } catch (e) {
        setError((e as Error).message);
      }
    }, 500);

    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const serverTrick = (state.currentTrick || []) as Array<{ seat: number; card: any }>;

    if (serverTrick.length > 0) {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setClearingTrickWinner(null);
      setRenderTrick(serverTrick);
      return;
    }

    if (renderTrick.length > 0 && clearingTrickWinner === null) {
      const winner = typeof state.turnIndex === 'number' ? state.turnIndex : 0;
      setClearingTrickWinner(winner);
      clearTimerRef.current = window.setTimeout(() => {
        setRenderTrick([]);
        setClearingTrickWinner(null);
        clearTimerRef.current = null;
      }, 700);
    }
  }, [state?.revision, state?.turnIndex, renderTrick, clearingTrickWinner, state]);

  const selfSeat = serviceRef.current.getSeat();
  const hand = useMemo(() => {
    if (!state) return [];
    const hands = (state as any).hands || {};
    return hands[selfSeat] || [];
  }, [state, selfSeat]);

  const avatarPlayers: Player[] = useMemo(() => {
    if (!state) return [];
    const hands = (state as any).hands || {};
    const scores = (state as any).scores || {};
    const trickWins = (state as any).trickWins || {};
    const players = Array.isArray((state as any).players) ? (state as any).players : [];

    return players.map((p: any) => ({
      id: p.seat,
      name: p.name,
      avatar: p.isBot ? '🤖' : p.seat === 0 ? '👤' : '🧑',
      hand: hands[p.seat] || [],
      score: scores[p.seat] || 0,
      currentRoundScore: 0,
      isHuman: !p.isBot,
      tricksWon: trickWins[p.seat] || 0,
      teamId: p.teamId,
    }));
  }, [state]);

  const handLayout = useMemo(() => {
    if (!hand.length) return [] as Array<{ card: any; x: number }>;
    const containerWidth = Math.min(typeof window !== 'undefined' ? window.innerWidth : 420, 430);
    const weights = hand.map((_, idx) => 1 + Math.max(0, 1 - Math.abs(idx - (hand.length - 1) / 2) / (hand.length || 1)));
    const sumWeights = weights.reduce((s, w) => s + w, 0);
    const gapPerWeight = hand.length > 1 ? Math.max(0, containerWidth - 120) / sumWeights : 0;
    let currentX = (containerWidth - (sumWeights * gapPerWeight + 88)) / 2 + 16;
    return hand.map((card, idx) => {
      const x = currentX;
      currentX += weights[idx] * gapPerWeight;
      return { card, x };
    });
  }, [hand]);

  const submit = async (cardId: string) => {
    if (!state || state.turnIndex !== selfSeat || state.status !== 'PLAYING') return;
    try {
      const next = await serviceRef.current.submitMove(cardId);
      setState({ ...next });

      if (next.status === 'COMPLETED') {
        const finished = await serviceRef.current.finish();
        const mine = finished.rewards.find((r) => r.seat === selfSeat);
        setResult(`Match complete. Coin delta: ${mine?.coinsDelta ?? 0}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading) {
    return <div className="h-screen w-full felt-bg flex items-center justify-center text-white font-black">Creating online match...</div>;
  }

  if (error) {
    return (
      <div className="h-screen w-full felt-bg flex flex-col items-center justify-center gap-4 text-white">
        <div className="font-black text-red-400 text-center px-4 whitespace-pre-wrap max-w-[90vw]">{error}</div>
        <button className="px-4 py-2 rounded-xl bg-yellow-500 text-black font-black" onClick={onExit}>Back</button>
      </div>
    );
  }

  if (!state) return null;

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden text-white">
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <button className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-xs font-black uppercase" onClick={onExit}>Exit</button>
        <div className="text-sm uppercase font-black tracking-widest">{state.gameType} Online</div>
        {state.status === 'PLAYING' ? (
          <TurnTimer deadlineMs={state.turnDeadlineMs} serverTimeMs={state.serverTimeMs} />
        ) : (
          <div className="text-[10px] font-black uppercase text-yellow-300">Waiting...</div>
        )}
      </div>

      <div className="h-[70%] relative w-full">
        {avatarPlayers[0] && (
          <Avatar player={avatarPlayers[0]} pos="bottom-6 left-1/2 -translate-x-1/2" active={state.turnIndex === 0} phase="PLAYING" gameType={gameType} />
        )}
        {avatarPlayers[1] && (
          <Avatar player={avatarPlayers[1]} pos="top-1/2 right-4 -translate-y-1/2" active={state.turnIndex === 1} phase="PLAYING" gameType={gameType} />
        )}
        {avatarPlayers[2] && (
          <Avatar player={avatarPlayers[2]} pos="top-6 left-1/2 -translate-x-1/2" active={state.turnIndex === 2} phase="PLAYING" gameType={gameType} />
        )}
        {avatarPlayers[3] && (
          <Avatar player={avatarPlayers[3]} pos="top-1/2 left-4 -translate-y-1/2" active={state.turnIndex === 3} phase="PLAYING" gameType={gameType} />
        )}

        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[20rem] h-[20rem] flex items-center justify-center pointer-events-none">
          <div className="flex gap-3 justify-center min-h-[86px] items-center relative">
            {state.status === 'WAITING' ? (
              <span className="text-xs text-yellow-300">Waiting for second player to join...</span>
            ) : renderTrick.length === 0 ? <span className="text-xs text-white/50">Waiting for first card...</span> : renderTrick.map((t, idx) => {
              const off = [{ x: 0, y: 45 }, { x: 60, y: 0 }, { x: 0, y: -45 }, { x: -60, y: 0 }][t.seat] || { x: 0, y: 0 };
              const startPos = [{ x: 0, y: 350 }, { x: 400, y: 0 }, { x: 0, y: -350 }, { x: -400, y: 0 }][t.seat] || { x: 0, y: 0 };
              const winDir = [{ x: 0, y: 600 }, { x: 500, y: 0 }, { x: 0, y: -600 }, { x: -500, y: 0 }][clearingTrickWinner ?? 0] || { x: 0, y: 0 };
              return (
                <div
                  key={`${t.seat}-${t.card.id}-${idx}`}
                  className={`absolute animate-play ${clearingTrickWinner !== null ? 'animate-clear' : ''}`}
                  style={{
                    '--play-x': `${off.x}px`,
                    '--play-y': `${off.y}px`,
                    '--play-rot': '0deg',
                    '--start-x': `${startPos.x}px`,
                    '--start-y': `${startPos.y}px`,
                    '--clear-x': `${winDir.x}px`,
                    '--clear-y': `${winDir.y}px`,
                    zIndex: 10 + idx,
                  } as any}
                >
                  <CardView card={t.card} size="md" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black via-black/40 to-transparent">
        <div className="relative w-full flex-1">
          {handLayout.map((item, idx, arr) => (
            <button
              key={item.card.id}
              onClick={() => submit(item.card.id)}
              disabled={state.turnIndex !== selfSeat || state.status !== 'PLAYING'}
              className={`absolute card-fan-item animate-deal ${state.turnIndex === selfSeat ? 'cursor-pointer active:-translate-y-2' : 'opacity-70 cursor-default'}`}
              style={{
                transform: `translate3d(${item.x}px, ${Math.pow(idx - (arr.length - 1) / 2, 2) * 0.4}px, 0) rotate(${(idx - (arr.length - 1) / 2) * 2}deg)`,
                zIndex: 100 + idx,
              }}
            >
              <CardView card={item.card} size="lg" />
            </button>
          ))}
        </div>
      </div>

      {result && <div className="mt-2 text-center text-sm font-black text-green-400">{result}</div>}
    </div>
  );
}
