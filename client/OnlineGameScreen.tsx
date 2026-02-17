import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, CardView, Overlay } from '../SharedComponents';
import { GameType, Player } from '../types';
import { MultiplayerService } from './online/network/multiplayerService';
import { MultiplayerGameState } from './online/types';
import { TurnTimer } from './online/ui/TurnTimer';
import { getLocalPlayerName } from './online/network/playerName';
import { applyOnlineCoinDelta } from './online/network/coinWallet';
import { getCallbreakAutoMoveOnTimeout } from './online/network/callbreakOnlinePrefs';
import { getOnlineTurnDurationMs } from './online/config';
import { sortCardsBySuitThenRankAsc } from '../services/cardSort';

export function OnlineGameScreen({ gameType, onExit }: { gameType: GameType; onExit: () => void }) {
  const serviceRef = useRef<MultiplayerService>(new MultiplayerService());
  const subscriptionListenerRef = useRef<((next: MultiplayerGameState) => void) | null>(null);
  const [state, setState] = useState<MultiplayerGameState | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [debugTapCount, setDebugTapCount] = useState(0);
  const [renderTrick, setRenderTrick] = useState<Array<{ seat: number; card: any }>>([]);
  const [clearingTrickWinner, setClearingTrickWinner] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState<number>(Date.now());
  const clearTimerRef = useRef<number | null>(null);
  const lastCompletedAtRef = useRef<number>(0);
  const [selectedPassIds, setSelectedPassIds] = useState<string[]>([]);
  const [dragInfo, setDragInfo] = useState<{ id: string; startY: number; currentY: number } | null>(null);

  // ---------- Init & Subscription ----------
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        setLoading(true);
        const created = await serviceRef.current.createMatch(gameType, getLocalPlayerName(), {
          autoMoveOnTimeout: gameType === 'CALLBREAK' ? getCallbreakAutoMoveOnTimeout() : true,
        });
        if (!mounted) return;
        setState(created);
        const boundListener = (next: MultiplayerGameState) => {
          setState((prev) => {
            if (!prev) return { ...next };
            if ((next.revision || 0) < (prev.revision || 0)) return prev;
            return { ...next };
          });
        };
        subscriptionListenerRef.current = boundListener;
        await serviceRef.current.subscribeToMatch(boundListener);
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    init();
    return () => {
      mounted = false;
      if (subscriptionListenerRef.current) {
        void serviceRef.current.unsubscribeFromMatch(subscriptionListenerRef.current);
        subscriptionListenerRef.current = null;
      } else {
        void serviceRef.current.unsubscribeFromMatch();
      }
    };
  }, [gameType]);

  // ---------- Turn Timeout ----------
  useEffect(() => {
    if (!state || state.status !== 'PLAYING' || state.phase !== 'PLAYING') return;
    const turnPlayer = state.players?.[state.turnIndex ?? 0];
    if (!turnPlayer) return;
    const delay = Math.max(0, (state.turnDeadlineMs || 0) - Date.now()) + 50;
    const timeout = window.setTimeout(async () => {
      try {
        const next = await serviceRef.current.forceTimeout();
        if (next) setState({ ...next });
      } catch {}
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [state?.revision, state?.turnDeadlineMs, state?.turnIndex, state?.status, state?.phase]);

  // ---------- Clock for timer UI ----------
  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  // ---------- Debug tap reset ----------
  useEffect(() => {
    if (debugTapCount <= 0) return;
    const timer = window.setTimeout(() => setDebugTapCount(0), 1200);
    return () => window.clearTimeout(timer);
  }, [debugTapCount]);

  const showMessage = (text: string, ms = 1800) => {
    setMessage(text);
    window.setTimeout(() => setMessage((prev) => (prev === text ? '' : prev)), ms);
  };

  // ---------- Cleanup clear timer ----------
  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    };
  }, []);

  // ---------- Trick Rendering Logic ----------
  useEffect(() => {
    if (!state) return;
    const serverTrick = (state.currentTrick || []) as Array<{ seat: number; card: any }>;
    const completed = (state as any).lastCompletedTrick as { trick: Array<{ seat: number; card: any }>; winner: number; at: number } | null;

    // If there are cards in the current trick, show them
    if (serverTrick.length > 0) {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setClearingTrickWinner(null);
      setRenderTrick(serverTrick);
      return;
    }

    // If a trick just completed, show it then animate it away
    if (completed && completed.at && completed.at > lastCompletedAtRef.current && Array.isArray(completed.trick) && completed.trick.length > 0) {
      lastCompletedAtRef.current = completed.at;
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setRenderTrick(completed.trick);
      setClearingTrickWinner(typeof completed.winner === 'number' ? completed.winner : (typeof state.turnIndex === 'number' ? state.turnIndex : 0));
      clearTimerRef.current = window.setTimeout(() => {
        setRenderTrick([]);
        setClearingTrickWinner(null);
        clearTimerRef.current = null;
      }, 850);
      return;
    }

    // Trick area now empty and no new completion — clear after short delay
    if (renderTrick.length > 0 && clearingTrickWinner === null) {
      const winner = typeof state.turnIndex === 'number' ? state.turnIndex : 0;
      setClearingTrickWinner(winner);
      clearTimerRef.current = window.setTimeout(() => {
        setRenderTrick([]);
        setClearingTrickWinner(null);
        clearTimerRef.current = null;
      }, 850);
    }
  }, [state?.revision, state?.turnIndex, renderTrick, clearingTrickWinner, state]);

  // ---------- Derived state ----------
  const selfSeat = serviceRef.current.getSeat();
  const toViewSeat = (seat: number) => (seat - selfSeat + 4) % 4;
  const toGlobalSeat = (viewSeat: number) => (viewSeat + selfSeat) % 4;

  // Properly derive phase from state
  const phase = useMemo<'WAITING' | 'PASSING' | 'BIDDING' | 'PLAYING' | 'COMPLETED'>(() => {
    if (!state) return 'WAITING';
    if (state.phase) return state.phase as any;
    if (state.status === 'WAITING') return 'WAITING';
    if (state.status === 'COMPLETED') return 'COMPLETED';
    return 'PLAYING';
  }, [state?.phase, state?.status]);

  const hand = useMemo(() => {
    if (!state) return [];
    const hands = (state as any).hands || {};
    return sortCardsBySuitThenRankAsc(hands[selfSeat] || []);
  }, [state, selfSeat]);

  const avatarPlayers: Player[] = useMemo(() => {
    if (!state) return [];
    const hands = (state as any).hands || {};
    const scores = (state as any).scores || {};
    const trickWins = (state as any).trickWins || (state as any).tricksWon || { 0: 0, 1: 0, 2: 0, 3: 0 };
    const bids = (state as any).bids || {};
    const players = Array.isArray((state as any).players) ? (state as any).players : [];

    return players.map((p: any) => ({
      id: p.seat,
      name: p.name,
      avatar: p.isBot ? '🤖' : p.seat === selfSeat ? '👤' : '🧑',
      hand: hands[p.seat] || [],
      score: scores[p.seat] || 0,
      currentRoundScore: 0,
      isHuman: !p.isBot,
      bid: bids[p.seat] ?? bids[String(p.seat)] ?? undefined,
      tricksWon: trickWins[p.seat] || 0,
      teamId: p.teamId,
    })).sort((a: Player, b: Player) => toViewSeat(a.id) - toViewSeat(b.id));
  }, [state, selfSeat]);

  // ---------- Card layout ----------
  const handLayout = useMemo(() => {
    if (!hand.length) return [] as Array<{ card: any; x: number }>;
    const containerWidth = Math.min(typeof window !== 'undefined' ? window.innerWidth : 420, 440);
    const cardWidth = 80;
    const available = Math.max(100, containerWidth - 40);
    const isMyTurn = phase === 'PLAYING' && state?.turnIndex === selfSeat;
    const step = hand.length > 1 ? Math.max(20, (available - cardWidth) / (hand.length - 1)) : 0;
    const total = cardWidth + step * (hand.length - 1);
    let currentX = Math.max(8, (containerWidth - total) / 2);
    return hand.map((card: any, idx: number) => {
      const x = currentX;
      currentX += step;
      return { card, x };
    });
  }, [hand, phase, state?.turnIndex, selfSeat]);

  const playableIds = useMemo(() => {
    if (!state || state.status !== 'PLAYING' || phase !== 'PLAYING') return new Set<string>();
    if (state.turnIndex !== selfSeat) return new Set<string>();
    const currentHand = ((state as any).hands || {})[selfSeat] || [];
    if (!Array.isArray(currentHand) || currentHand.length === 0) return new Set<string>();
    const leadSuit = (state as any).leadSuit || null;
    if (!leadSuit) return new Set(currentHand.map((c: any) => c.id));

    const hasLeadSuit = currentHand.some((c: any) => c.suit === leadSuit);
    if (hasLeadSuit) return new Set(currentHand.filter((c: any) => c.suit === leadSuit).map((c: any) => c.id));

    if (state.gameType === 'CALLBREAK') {
      const hasSpades = currentHand.some((c: any) => c.suit === 'SPADES');
      if (hasSpades) return new Set(currentHand.filter((c: any) => c.suit === 'SPADES').map((c: any) => c.id));
    }

    return new Set(currentHand.map((c: any) => c.id));
  }, [state, selfSeat, phase]);

  // Reset pass selection when phase changes
  useEffect(() => {
    if (phase !== 'PASSING') setSelectedPassIds([]);
  }, [phase]);

  // ---------- Drag handlers ----------
  const onDragStart = (e: React.MouseEvent | React.TouchEvent, id: string) => {
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    setDragInfo({ id, startY: clientY, currentY: clientY });
  };

  const onDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragInfo) return;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    setDragInfo(prev => prev ? { ...prev, currentY: clientY } : null);
  };

  const onDragEnd = (card: any) => {
    if (!dragInfo) return;
    const diff = dragInfo.startY - dragInfo.currentY;
    if (phase === 'PASSING' && state?.turnIndex === selfSeat) {
      togglePassCard(card.id);
    } else if (diff > 50 || Math.abs(diff) < 10) {
      submit(card.id);
    }
    setDragInfo(null);
  };

  // ---------- Actions ----------
  const submit = async (cardId: string) => {
    if (!state) return;
    if (state.status === 'WAITING' || phase === 'WAITING') {
      showMessage('Waiting for players...');
      return;
    }
    if (state.status !== 'PLAYING') return;
    if (phase !== 'PLAYING') {
      showMessage(phase === 'PASSING' ? 'Complete passing first' : phase === 'BIDDING' ? 'Complete bidding first' : 'Setting up...');
      return;
    }
    if (state.turnIndex !== selfSeat) {
      showMessage('Wait for your turn');
      return;
    }
    if (!playableIds.has(cardId)) {
      const lead = (state as any).leadSuit;
      showMessage(lead ? `Must follow ${lead}` : 'Invalid move');
      return;
    }
    try {
      const next = await serviceRef.current.submitMove(cardId);
      setState({ ...next });
      setMessage('');

      if (next.status === 'COMPLETED') {
        try {
          const finished = await serviceRef.current.finish();
          const mine = finished.rewards.find((r) => r.seat === selfSeat);
          if (mine?.coinsDelta) applyOnlineCoinDelta(mine.coinsDelta);
          setResult(`Match complete! ${mine?.coinsDelta && mine.coinsDelta > 0 ? `+${mine.coinsDelta}` : mine?.coinsDelta ?? 0} coins`);
        } catch {}
      }
    } catch (e) {
      const msg = (e as Error).message || '';
      if (
        msg.includes('Revision mismatch') ||
        msg.includes('Not your turn') ||
        msg.includes('Round setup in progress') ||
        msg.includes('Not in bidding phase') ||
        msg.includes('Not in passing phase')
      ) {
        try {
          const next = await serviceRef.current.syncSnapshot();
          if (next) setState({ ...next });
          showMessage('Synced', 1000);
          return;
        } catch {}
      }
      setError(msg);
    }
  };

  const togglePassCard = (cardId: string) => {
    if (phase !== 'PASSING') return;
    setSelectedPassIds((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
      if (prev.length >= 3) return prev;
      return [...prev, cardId];
    });
  };

  const confirmPass = async () => {
    if (!state || phase !== 'PASSING') return;
    if (selectedPassIds.length !== 3) {
      showMessage('Select exactly 3 cards');
      return;
    }
    try {
      const next = await serviceRef.current.submitPass(selectedPassIds);
      setState({ ...next });
      setSelectedPassIds([]);
      showMessage('Cards passed!');
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('Revision mismatch') || msg.includes('Already passed')) {
        try {
          const next = await serviceRef.current.syncSnapshot();
          if (next) setState({ ...next });
          showMessage('Synced', 1000);
          setSelectedPassIds([]);
          return;
        } catch {}
      }
      setError(msg);
    }
  };

  const submitBid = async (bid: number) => {
    if (!state || phase !== 'BIDDING') return;
    if (state.turnIndex !== selfSeat) {
      showMessage('Wait for your bidding turn');
      return;
    }
    try {
      const next = await serviceRef.current.submitBid(bid);
      setState({ ...next });
      showMessage(`Bid ${bid} submitted`);
    } catch (e) {
      const msg = (e as Error).message || '';
      if (msg.includes('Revision mismatch') || msg.includes('Not your turn')) {
        try {
          const next = await serviceRef.current.syncSnapshot();
          if (next) setState({ ...next });
          showMessage('Synced', 1000);
          return;
        } catch {}
      }
      setError(msg);
    }
  };

  // ---------- Rendering ----------
  if (loading) {
    return (
      <div className="h-screen w-full felt-bg flex flex-col items-center justify-center text-white">
        <div className="text-5xl mb-4 animate-pulse">🃏</div>
        <div className="font-black text-lg uppercase tracking-widest">Finding Match...</div>
        <div className="text-[10px] text-white/40 mt-2 uppercase tracking-widest">{gameType} Online</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-full felt-bg flex flex-col items-center justify-center gap-4 text-white">
        <div className="text-4xl mb-2">⚠️</div>
        <div className="font-black text-red-400 text-center px-4 whitespace-pre-wrap max-w-[90vw] text-sm">{error}</div>
        <button className="px-6 py-3 rounded-2xl bg-yellow-500 text-black font-black uppercase" onClick={onExit}>Back to Home</button>
      </div>
    );
  }

  if (!state) return null;

  const syncDebug = serviceRef.current.getSyncDebug();
  const isMyTurn = phase === 'PLAYING' && state.turnIndex === selfSeat;
  const passingDirection = (state as any).passingDirection || 'LEFT';
  const bids = (state as any).bids || {};
  const scores = (state as any).scores || {};
  const trickWins = (state as any).trickWins || (state as any).tricksWon || { 0: 0, 1: 0, 2: 0, 3: 0 };

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden text-white" onMouseMove={onDragMove} onTouchMove={onDragMove}>
      {/* HEADER BAR */}
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <button className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-lg" onClick={onExit}>🏠</button>

        <button
          type="button"
          className="flex flex-col items-center"
          onClick={() => {
            const next = debugTapCount + 1;
            if (next >= 5) { setShowDebugOverlay(p => !p); setDebugTapCount(0); return; }
            setDebugTapCount(next);
          }}
        >
          <span className="text-[8px] text-white/30 font-black uppercase tracking-[0.3em]">{gameType} Online</span>
          <span className="text-xl font-black italic text-yellow-500 leading-tight">
            {phase === 'PASSING' ? 'PASSING' : phase === 'BIDDING' ? 'BIDDING' : phase === 'COMPLETED' ? 'DONE' : `R${state.roundNumber || 1}`}
          </span>
        </button>

        {state.status === 'PLAYING' && phase === 'PLAYING' ? (
          <TurnTimer
            deadlineMs={state.turnDeadlineMs}
            serverTimeMs={state.serverTimeMs}
            durationMs={getOnlineTurnDurationMs(
              gameType,
              !!(state.players?.[state.turnIndex ?? 0]?.isBot || state.players?.[state.turnIndex ?? 0]?.disconnected)
            )}
          />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
            <span className="text-[9px] font-black uppercase text-yellow-300/70">
              {phase === 'WAITING' ? '⏳' : phase === 'COMPLETED' ? '🏆' : '⏳'}
            </span>
          </div>
        )}
      </div>

      {/* MESSAGE BANNER */}
      <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-[100] w-full flex justify-center pointer-events-none px-6">
        {message && (
          <div className="bg-yellow-400 text-black px-5 py-2 rounded-full text-[10px] font-black uppercase shadow-2xl tracking-widest border-2 border-white/30 animate-deal pointer-events-auto">
            {message}
          </div>
        )}
      </div>

      {/* GAME AREA */}
      <div className="h-[70%] relative w-full">
        {/* Player Avatars */}
        {avatarPlayers.map((p) => {
          const viewSeat = toViewSeat(p.id);
          const positions = [
            "bottom-6 left-1/2 -translate-x-1/2",
            "top-1/2 right-3 -translate-y-1/2",
            "top-6 left-1/2 -translate-x-1/2",
            "top-1/2 left-3 -translate-y-1/2",
          ];
          const isActiveTurn = phase === 'PLAYING'
            ? toViewSeat(state.turnIndex ?? 0) === viewSeat
            : phase === 'BIDDING'
              ? toViewSeat(state.turnIndex ?? 0) === viewSeat
              : false;

          return (
            <Avatar
              key={p.id}
              player={p}
              pos={positions[viewSeat]}
              active={isActiveTurn}
              isWinner={clearingTrickWinner !== null && toViewSeat(clearingTrickWinner) === viewSeat}
              phase={phase === 'BIDDING' ? 'BIDDING' : phase === 'PASSING' ? 'PASSING' : 'PLAYING'}
              gameType={gameType}
              turnProgress={
                state.status === 'PLAYING' && (phase === 'PLAYING' || phase === 'BIDDING') && isActiveTurn
                  ? Math.max(0, Math.min(1, (state.turnDeadlineMs - clockMs) / getOnlineTurnDurationMs(gameType, !!(state.players?.[state.turnIndex ?? 0]?.isBot || state.players?.[state.turnIndex ?? 0]?.disconnected))))
                  : undefined
              }
            />
          );
        })}

        {/* CENTER AREA — Trick cards / Phase messages */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[20rem] h-[20rem] flex items-center justify-center pointer-events-none">
          {phase === 'WAITING' ? (
            <div className="flex flex-col items-center gap-3 animate-fadeIn">
              <div className="text-4xl animate-pulse">🎮</div>
              <span className="text-xs text-yellow-300 font-black uppercase tracking-widest">Waiting for players...</span>
            </div>
          ) : phase === 'PASSING' ? (
            <div className="flex flex-col items-center gap-3 animate-fadeIn">
              <div className="text-3xl">🔄</div>
              <span className="text-xs text-yellow-300 font-black uppercase tracking-[0.2em]">
                {state.turnIndex === selfSeat ? `Pass 3 cards ${passingDirection}` : 'Waiting for other players to pass...'}
              </span>
              {state.turnIndex === selfSeat ? (
                <div className="flex gap-2 mt-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className={`w-10 h-14 rounded-lg border-2 flex items-center justify-center ${selectedPassIds[i] ? 'border-yellow-400 bg-yellow-400/20' : 'border-white/20 bg-white/5'}`}>
                      <span className="text-white/30 text-lg font-black">{selectedPassIds[i] ? '✓' : '?'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2 mt-1">
                  {[0, 1, 2, 3].map(s => {
                    const sel = ((state as any).passingSelections || {})[s] || [];
                    const hasPassed = sel.length === 3;
                    return (
                      <div key={s} className={`w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-black ${hasPassed ? 'border-green-400 bg-green-400/20 text-green-400' : 'border-white/20 bg-white/5 text-white/30'}`}>
                        {hasPassed ? '✓' : '⏳'}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : phase === 'BIDDING' ? (
            <div className="flex flex-col items-center gap-2 animate-fadeIn">
              <div className="text-3xl">🎯</div>
              <span className="text-xs text-yellow-300 font-black uppercase tracking-[0.2em]">
                {state.turnIndex === selfSeat ? 'Your bid' : 'Waiting for bids...'}
              </span>
              <div className="flex gap-3 mt-1">
                {[0, 1, 2, 3].map(s => {
                  const viewS = toViewSeat(s);
                  const bidVal = bids[s];
                  const hasBid = bidVal !== null && bidVal !== undefined;
                  return (
                    <div key={s} className={`w-10 h-10 rounded-full flex items-center justify-center border-2 text-sm font-black ${hasBid ? 'border-yellow-400 bg-yellow-400/20 text-yellow-400' : 'border-white/20 bg-white/5 text-white/30'}`}>
                      {hasBid ? bidVal : '?'}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : renderTrick.length === 0 ? (
            isMyTurn ? (
              <span className="text-xs text-yellow-300 font-black uppercase tracking-widest animate-pulse">Your turn!</span>
            ) : (
              <span className="text-xs text-white/30 font-black uppercase tracking-widest">Waiting...</span>
            )
          ) : (
            renderTrick.map((t, idx) => {
              const trickViewSeat = toViewSeat(t.seat);
              const winnerViewSeat = toViewSeat(clearingTrickWinner ?? toGlobalSeat(0));
              const off = [{ x: 0, y: 45 }, { x: 60, y: 0 }, { x: 0, y: -45 }, { x: -60, y: 0 }][trickViewSeat] || { x: 0, y: 0 };
              const startPos = [{ x: 0, y: 300 }, { x: 350, y: 0 }, { x: 0, y: -300 }, { x: -350, y: 0 }][trickViewSeat] || { x: 0, y: 0 };
              const winDir = [{ x: 0, y: 500 }, { x: 450, y: 0 }, { x: 0, y: -500 }, { x: -450, y: 0 }][winnerViewSeat] || { x: 0, y: 0 };
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
            })
          )}
        </div>
      </div>

      {/* HAND AREA */}
      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black via-black/40 to-transparent">
        <div className="relative w-full flex-1">
          {handLayout.map((item, idx, arr) => {
            const isDragging = dragInfo?.id === item.card.id;
            const isSelectedForPass = phase === 'PASSING' && state?.turnIndex === selfSeat && selectedPassIds.includes(item.card.id);
            const isInactive = phase === 'PLAYING' && state?.turnIndex === selfSeat && state.status === 'PLAYING' && !playableIds.has(item.card.id);
            return (
              <div
                key={item.card.id}
                onMouseDown={(e) => onDragStart(e, item.card.id)}
                onTouchStart={(e) => onDragStart(e, item.card.id)}
                onMouseUp={() => onDragEnd(item.card)}
                onTouchEnd={() => onDragEnd(item.card)}
                className={`absolute card-fan-item animate-deal cursor-grab ${isDragging || isSelectedForPass ? 'z-[600]' : ''} ${(phase === 'PLAYING' && state?.turnIndex === selfSeat) || (phase === 'PASSING' && state?.turnIndex === selfSeat) ? 'active:-translate-y-2' : 'opacity-80'}`}
                style={{
                  transform: `translate3d(${item.x}px, ${Math.pow(idx - (arr.length - 1) / 2, 2) * 0.35 + (isDragging ? dragInfo.currentY - dragInfo.startY : (isSelectedForPass ? -100 : 0))}px, 0) rotate(${(idx - (arr.length - 1) / 2) * 1.5}deg) scale(${isDragging ? 1.12 : 1})`,
                  zIndex: isDragging ? 600 : 100 + idx,
                }}
              >
                <CardView
                  card={item.card}
                  size="lg"
                  inactive={isInactive}
                  highlighted={isSelectedForPass}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* PASSING CONFIRM BUTTON — only when it's your turn to pass */}
      {phase === 'PASSING' && state.turnIndex === selfSeat && (
        <div className="absolute bottom-[calc(max(1rem,var(--safe-bottom))+8px)] left-1/2 -translate-x-1/2 z-[150] animate-fadeIn">
          <button
            onClick={confirmPass}
            disabled={selectedPassIds.length !== 3}
            className={`px-8 py-3.5 rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl transition-all ${
              selectedPassIds.length === 3
                ? 'bg-yellow-500 text-black active:translate-y-1 shadow-yellow-500/30'
                : 'bg-white/10 text-white/40 border border-white/15'
            }`}
          >
            {selectedPassIds.length < 3 ? `Choose ${3 - selectedPassIds.length} more` : 'Confirm Pass'}
          </button>
        </div>
      )}

      {/* BIDDING UI */}
      {phase === 'BIDDING' && state.turnIndex === selfSeat && (
        <div className="absolute left-1/2 -translate-x-1/2 z-[180] bg-black/85 border border-white/15 rounded-[2rem] p-5 shadow-2xl backdrop-blur-xl animate-fadeIn"
          style={{ bottom: 'calc(max(1rem, var(--safe-bottom)) + 140px)' }}>
          <div className="text-[10px] text-yellow-400 font-black uppercase tracking-[0.3em] mb-3 text-center">
            {gameType === 'CALLBREAK' ? 'How many tricks?' : 'Select your bid'}
          </div>
          <div className={`grid gap-2 ${gameType === 'SPADES' ? 'grid-cols-5' : 'grid-cols-4'}`}>
            {(gameType === 'SPADES' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] : [1, 2, 3, 4, 5, 6, 7, 8]).map((b) => (
              <button
                key={b}
                onClick={() => submitBid(b)}
                className={`w-11 h-11 rounded-xl font-black text-base transition-all active:scale-90 border ${
                  b === 0
                    ? 'bg-rose-600 text-white border-rose-400 hover:bg-rose-500'
                    : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500 hover:text-black'
                }`}
              >
                {b === 0 ? 'NIL' : b}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MATCH RESULT OVERLAY */}
      {(phase === 'COMPLETED' || result) && (
        <Overlay title="Match Complete" subtitle={gameType + ' Online'}>
          <div className="w-full space-y-3 mb-8">
            {avatarPlayers.map((p) => (
              <div key={p.id} className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center text-2xl">
                    {p.avatar}
                  </div>
                  <div className="text-left">
                    <span className="font-black text-sm uppercase block leading-tight">{p.name}</span>
                    <span className="text-[9px] opacity-40 font-bold uppercase">
                      {gameType === 'HEARTS' ? `${scores[p.id] || 0} pts` : `Tricks: ${trickWins[p.id] || 0}${p.bid !== undefined ? `/${p.bid}` : ''}`}
                    </span>
                  </div>
                </div>
                <div className="text-2xl font-black italic text-yellow-500">
                  {gameType === 'HEARTS' ? (scores[p.id] || 0) : (scores[p.id] || 0).toFixed ? (scores[p.id] || 0) : 0}
                </div>
              </div>
            ))}
          </div>
          {result && <div className="text-center text-sm font-black text-green-400 mb-4">{result}</div>}
          <button
            onClick={onExit}
            className="w-full py-5 rounded-3xl font-black text-xl bg-yellow-500 text-black uppercase shadow-2xl active:translate-y-1 transition-all"
          >
            Back to Home
          </button>
        </Overlay>
      )}

      {/* DEBUG OVERLAY */}
      {showDebugOverlay && (
        <div className="absolute left-2 top-[calc(var(--safe-top)+3.25rem)] z-[300] bg-black/85 border border-cyan-400/60 rounded-lg px-3 py-2 text-[10px] leading-4 font-mono text-cyan-200 max-w-[95vw] max-h-[45vh] overflow-auto">
          <div>match: {String(syncDebug.matchId || 'NA')}</div>
          <div>seat: {syncDebug.seat} rev: {syncDebug.revision} evt: {syncDebug.lastEventId}</div>
          <div>status: {String(syncDebug.status)} phase: {String(syncDebug.phase)} turn: {syncDebug.turnIndex}</div>
          <div>sub: {String(syncDebug.subscriptionId || 'NA')}</div>
          <div>pump: {String(syncDebug.eventPumpRunning)} inflight: {String(syncDebug.eventPumpInFlight)} empty: {syncDebug.emptyEventLoops}</div>
          <div className="text-[9px] text-cyan-400/80 mt-1">tap title 5x to hide</div>
        </div>
      )}
    </div>
  );
}
