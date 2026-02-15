import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, CardView } from '../SharedComponents';
import { GameType, Player } from '../types';
import { MultiplayerService } from './online/network/multiplayerService';
import { MultiplayerGameState } from './online/types';
import { PlayerStrip } from './online/ui/PlayerStrip';
import { TurnTimer } from './online/ui/TurnTimer';

export function OnlineGameScreen({ gameType, onExit }: { gameType: GameType; onExit: () => void }) {
  const serviceRef = useRef<MultiplayerService>(new MultiplayerService());
  const [state, setState] = useState<MultiplayerGameState | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        setLoading(true);
        const created = await serviceRef.current.createMatch(gameType, 'YOU');
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
    if (!state || state.status !== 'PLAYING') return;
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
    <div className="h-screen w-full felt-bg p-4 text-white flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <button className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-xs font-black uppercase" onClick={onExit}>Exit</button>
        <div className="text-xs uppercase font-black tracking-widest">{state.gameType} Online</div>
        <TurnTimer deadlineMs={state.turnDeadlineMs} serverTimeMs={state.serverTimeMs} />
      </div>

      <PlayerStrip players={state.players || []} activeSeat={state.turnIndex ?? 0} />

      <div className="mt-4 flex-1 relative rounded-3xl border border-white/10 bg-black/25 overflow-hidden">
        {avatarPlayers[0] && (
          <Avatar player={avatarPlayers[0]} pos="bottom-2 left-1/2 -translate-x-1/2" active={state.turnIndex === 0} phase="PLAYING" gameType={gameType} />
        )}
        {avatarPlayers[1] && (
          <Avatar player={avatarPlayers[1]} pos="left-2 top-1/2 -translate-y-1/2" active={state.turnIndex === 1} phase="PLAYING" gameType={gameType} />
        )}
        {avatarPlayers[2] && (
          <Avatar player={avatarPlayers[2]} pos="top-2 left-1/2 -translate-x-1/2" active={state.turnIndex === 2} phase="PLAYING" gameType={gameType} />
        )}
        {avatarPlayers[3] && (
          <Avatar player={avatarPlayers[3]} pos="right-2 top-1/2 -translate-y-1/2" active={state.turnIndex === 3} phase="PLAYING" gameType={gameType} />
        )}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex gap-3 justify-center min-h-[86px] items-center">
            {(state.currentTrick || []).length === 0 ? <span className="text-xs text-white/50">Waiting for first card...</span> : (state.currentTrick || []).map((t) => (
              <div key={`${t.seat}-${t.card.id}`} className="flex flex-col items-center gap-1">
                <CardView card={t.card} size="sm" />
                <span className="text-[9px]">Seat {t.seat}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-auto">
        <div className="text-[10px] uppercase text-white/60 mb-2">Your Hand</div>
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-2 min-w-max">
            {hand.map((card) => (
              <button
                key={card.id}
                onClick={() => submit(card.id)}
                disabled={state.turnIndex !== selfSeat}
                className={`transition-transform ${state.turnIndex === selfSeat ? 'active:-translate-y-2' : 'opacity-70'}`}
              >
                <CardView card={card} size="sm" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {result && <div className="mt-2 text-center text-sm font-black text-green-400">{result}</div>}
    </div>
  );
}
