import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Avatar, CardView, Overlay } from '../SharedComponents';
import { GameType, Player, Card } from '../types';
import { MultiplayerService } from './online/network/multiplayerService';
import { MultiplayerGameState } from './online/types';
import { TurnTimer } from './online/ui/TurnTimer';
import { getLocalPlayerName } from './online/network/playerName';
import { applyOnlineCoinDelta } from './online/network/coinWallet';
import { getCallbreakAutoMoveOnTimeout } from './online/network/callbreakOnlinePrefs';
import { getOnlineTurnDurationMs } from './online/config';
import { sortCardsBySuitThenRankAsc } from '../services/cardSort';

interface PhaseData {
  passingSelections?: Record<number, string[]>;
  passingDirection?: 'LEFT' | 'RIGHT' | 'ACROSS' | 'NONE';
  passingComplete?: Record<number, boolean>;
  biddingComplete?: Record<number, boolean>;
  currentPhaseStartTime?: number;
}

interface EnhancedGameState extends MultiplayerGameState {
  phaseData?: PhaseData;
  lastCompletedTrick?: {
    trick: Array<{ seat: number; card: Card }>;
    winner: number;
    at: number;
  };
}

export function EnhancedOnlineGameScreen({ gameType, onExit }: { gameType: GameType; onExit: () => void }) {
  const serviceRef = useRef<MultiplayerService>(new MultiplayerService());
  const subscriptionListenerRef = useRef<((next: MultiplayerGameState) => void) | null>(null);
  const [state, setState] = useState<EnhancedGameState | null>(null);
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

  // Phase-specific state
  const [selectedPassIds, setSelectedPassIds] = useState<string[]>([]);
  const [passingConfirmed, setPassingConfirmed] = useState(false);
  const [biddingValue, setBiddingValue] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        setLoading(true);
        const created = await serviceRef.current.createMatch(gameType, getLocalPlayerName(), {
          autoMoveOnTimeout: gameType === 'CALLBREAK' ? getCallbreakAutoMoveOnTimeout() : true,
        });
        if (!mounted) return;
        setState(created as EnhancedGameState);
        const boundListener = (next: MultiplayerGameState) => {
          setState((prev) => {
            if (!prev) return { ...next } as EnhancedGameState;
            if ((next.revision || 0) < (prev.revision || 0)) return prev;
            return { ...next } as EnhancedGameState;
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

  // Enhanced timeout handling with phase awareness
  useEffect(() => {
    if (!state || state.status !== 'PLAYING') return;
    const turnPlayer = state.players?.[state.turnIndex ?? 0];
    if (!turnPlayer) return;
    
    const delay = Math.max(0, (state.turnDeadlineMs || 0) - Date.now()) + 30;
    const timeout = window.setTimeout(async () => {
      try {
        const next = await serviceRef.current.forceTimeout();
        if (next) setState({ ...next } as EnhancedGameState);
      } catch {
        // Timeout races are expected when another client already advanced turn.
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [state?.revision, state?.turnDeadlineMs, state?.turnIndex, state?.status, state?.phase]);

  useEffect(() => {
    if (gameType !== 'CALLBREAK') return;
    const timer = window.setInterval(() => setClockMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [gameType]);

  useEffect(() => {
    if (debugTapCount <= 0) return;
    const timer = window.setTimeout(() => setDebugTapCount(0), 1200);
    return () => window.clearTimeout(timer);
  }, [debugTapCount]);

  const showMessage = useCallback((text: string, ms = 1500) => {
    setMessage(text);
    window.setTimeout(() => setMessage((prev) => (prev === text ? '' : prev)), ms);
  }, []);

  // Enhanced trick rendering with proper completion handling
  useEffect(() => {
    if (!state) return;
    const serverTrick = (state.currentTrick || []) as Array<{ seat: number; card: any }>;
    const completed = state.lastCompletedTrick;

    if (serverTrick.length > 0) {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setClearingTrickWinner(null);
      setRenderTrick(serverTrick);
      return;
    }

    if (completed && completed.at && completed.at > lastCompletedAtRef.current && Array.isArray(completed.trick) && completed.trick.length > 0) {
      lastCompletedAtRef.current = completed.at;
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setRenderTrick(completed.trick);
      setClearingTrickWinner(completed.winner);
      clearTimerRef.current = window.setTimeout(() => {
        setRenderTrick([]);
        setClearingTrickWinner(null);
        clearTimerRef.current = null;
      }, 800);
      return;
    }

    if (renderTrick.length > 0 && clearingTrickWinner === null) {
      // Fallback: we have cards but server says empty and no new lastCompletedTrick.
      // Only animate to winner if we have 4 cards (a full completed trick).
      // With 1–3 cards this could be the first card(s) of the next trick — do not
      // animate those to the previous winner (turnIndex).
      if (renderTrick.length === 4) {
        const winner = typeof state.turnIndex === 'number' ? state.turnIndex : 0;
        setClearingTrickWinner(winner);
      }
      clearTimerRef.current = window.setTimeout(() => {
        setRenderTrick([]);
        setClearingTrickWinner(null);
        clearTimerRef.current = null;
      }, renderTrick.length === 4 ? 800 : 300);
    }
  }, [state?.revision, state?.turnIndex, renderTrick, clearingTrickWinner, state]);

  const selfSeat = serviceRef.current.getSeat();
  const toViewSeat = (seat: number) => (seat - selfSeat + 4) % 4;
  const toGlobalSeat = (viewSeat: number) => (viewSeat + selfSeat) % 4;
  const phase = (state?.phase || (state?.status === 'WAITING' ? 'WAITING' : 'WAITING')) as 'WAITING' | 'PASSING' | 'BIDDING' | 'PLAYING' | 'COMPLETED';
  
  const hand = useMemo(() => {
    if (!state) return [];
    const hands = (state as any).hands || {};
    return sortCardsBySuitThenRankAsc(hands[selfSeat] || []);
  }, [state, selfSeat]);

  const avatarPlayers: Player[] = useMemo(() => {
    if (!state) return [];
    const hands = (state as any).hands || {};
    const scores = (state as any).scores || {};
    const trickWins = (state as any).trickWins || (state as any).tricksWon || {};
    const bids = (state as any).bids || {};
    const players = Array.isArray((state as any).players) ? (state as any).players : [];

    return players.map((p: any) => ({
      id: p.seat,
      name: p.name,
      avatar: p.isBot ? '🤖' : p.seat === 0 ? '👤' : '🧑',
      hand: hands[p.seat] || [],
      score: scores[p.seat] || 0,
      currentRoundScore: 0,
      isHuman: !p.isBot,
      bid: bids[p.seat] ?? bids[String(p.seat)] ?? undefined,
      tricksWon: trickWins[p.seat] || 0,
      teamId: p.teamId,
    })).sort((a, b) => toViewSeat(a.id) - toViewSeat(b.id));
  }, [state, selfSeat]);

  const handLayout = useMemo(() => {
    if (!hand.length) return [] as Array<{ card: any; x: number }>;
    const containerWidth = Math.min(typeof window !== 'undefined' ? window.innerWidth : 420, 440);
    const cardWidth = 88;
    const available = Math.max(100, containerWidth - 48);
    const step = hand.length > 1 ? Math.max(18, (available - cardWidth) / (hand.length - 1)) : 0;
    const total = cardWidth + step * (hand.length - 1);
    let currentX = Math.max(8, (containerWidth - total) / 2);
    return hand.map((card, idx) => {
      const x = currentX;
      currentX += step;
      return { card, x };
    });
  }, [hand]);

  const playableIds = useMemo(() => {
    if (!state || state.status !== 'PLAYING' || phase !== 'PLAYING') return new Set<string>();
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

  // Reset phase-specific state when phase changes
  useEffect(() => {
    if (phase !== 'PASSING') {
      setSelectedPassIds([]);
      setPassingConfirmed(false);
    }
    if (phase !== 'BIDDING') {
      setBiddingValue(null);
    }
  }, [phase, state?.revision]);

  const submitCard = async (cardId: string) => {
    if (!state) return;
    if (state.status === 'WAITING' || phase === 'WAITING') {
      showMessage('Waiting for second player...');
      return;
    }
    if (state.status !== 'PLAYING') return;
    if (phase !== 'PLAYING') {
      showMessage(phase === 'PASSING' ? 'Complete passing first' : phase === 'BIDDING' ? 'Complete bidding first' : 'Round setup in progress');
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
      setState({ ...next } as EnhancedGameState);
      setMessage('');

      if (next.status === 'COMPLETED') {
        const finished = await serviceRef.current.finish();
        const mine = finished.rewards.find((r) => r.seat === selfSeat);
        if (mine?.coinsDelta) applyOnlineCoinDelta(mine.coinsDelta);
        setResult(`Match complete. Coin delta: ${mine?.coinsDelta ?? 0}`);
      }
    } catch (e) {
      const msg = (e as Error).message || '';
      // Non-fatal race cases: resync and continue.
      if (
        msg.includes('Revision mismatch') ||
        msg.includes('Not your turn') ||
        msg.includes('Round setup in progress') ||
        msg.includes('Waiting for second player') ||
        msg.includes('Not in bidding phase') ||
        msg.includes('Not in passing phase')
      ) {
        try {
          const next = await serviceRef.current.syncSnapshot();
          if (next) setState({ ...next } as EnhancedGameState);
          showMessage('State synced', 1200);
          return;
        } catch {}
      }
      setError(msg);
    }
  };

  const togglePassCard = (cardId: string) => {
    if (phase !== 'PASSING') return;
    if (!state || state.turnIndex !== selfSeat) {
      showMessage('Wait for your passing turn');
      return;
    }
    if (passingConfirmed) {
      showMessage('Passing already confirmed');
      return;
    }
    
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
    if (passingConfirmed) {
      showMessage('Already confirmed');
      return;
    }
    
    try {
      const next = await serviceRef.current.submitPass(selectedPassIds);
      setState({ ...next } as EnhancedGameState);
      setPassingConfirmed(true);
      showMessage('Cards passed');
    } catch (e) {
      setError((e as Error).message);
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
      setState({ ...next } as EnhancedGameState);
      setBiddingValue(bid);
      showMessage(`Bid ${bid} submitted`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const getPhaseMessage = () => {
    if (!state) return '';
    
    switch (phase) {
      case 'WAITING':
        return 'Waiting for players to join...';
      case 'PASSING':
        if (gameType === 'HEARTS') {
          const direction = state.phaseData?.passingDirection || 'LEFT';
          const isMyTurn = !passingConfirmed && selectedPassIds.length < 3;
          return isMyTurn ? `Select 3 cards to pass ${direction.toLowerCase()}` : `Passing ${direction.toLowerCase()}...`;
        }
        return 'Passing phase in progress...';
      case 'BIDDING':
        if (state.turnIndex === selfSeat && biddingValue === null) {
          return `Your turn to bid (${gameType === 'CALLBREAK' ? '1-8' : '0-13'})`;
        }
        return 'Bidding in progress...';
      case 'PLAYING':
        if (state.turnIndex === selfSeat) {
          return 'Your turn to play';
        }
        return `${avatarPlayers.find(p => p.id === state.turnIndex)?.name || 'Player'}'s turn`;
      case 'COMPLETED':
        return 'Game completed';
      default:
        return '';
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
  const syncDebug = serviceRef.current.getSyncDebug();

  return (
    <div className="h-screen w-full flex flex-col select-none relative overflow-hidden text-white">
      {/* Header */}
      <div className="h-[10%] w-full flex justify-between items-center px-4 pt-[var(--safe-top)] z-50 bg-black/80 shadow-2xl border-b border-white/5">
        <button className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-xs font-black uppercase" onClick={onExit}>Exit</button>
        <button
          type="button"
          className="text-sm uppercase font-black tracking-widest px-2 py-1"
          onClick={() => {
            const next = debugTapCount + 1;
            if (next >= 5) {
              setShowDebugOverlay((prev) => !prev);
              setDebugTapCount(0);
              return;
            }
            setDebugTapCount(next);
          }}
        >
          {state.gameType} Online
        </button>
        {state.status === 'PLAYING' ? (
          gameType === 'CALLBREAK' ? (
            <div className="text-[10px] font-black uppercase text-yellow-300">
              {phase.charAt(0) + phase.slice(1).toLowerCase()}
            </div>
          ) : (
            <TurnTimer
              deadlineMs={state.turnDeadlineMs}
              serverTimeMs={state.serverTimeMs}
              durationMs={getOnlineTurnDurationMs(
                gameType,
                !!(state.players?.[state.turnIndex ?? 0]?.isBot || state.players?.[state.turnIndex ?? 0]?.disconnected)
              )}
            />
          )
        ) : (
          <div className="text-[10px] font-black uppercase text-yellow-300">Waiting...</div>
        )}
      </div>

      {/* Phase Message */}
      <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-[100] w-full flex justify-center pointer-events-none px-6">
        {(message || getPhaseMessage()) && (
          <div className="bg-yellow-400 text-black px-5 py-2 rounded-full text-[10px] font-black uppercase shadow-2xl tracking-widest border-2 border-white/30 animate-deal">
            {message || getPhaseMessage()}
          </div>
        )}
      </div>

      {/* Game Area */}
      <div className="h-[70%] relative w-full">
        {/* Player Avatars */}
        {avatarPlayers.map((p) => {
          const viewSeat = toViewSeat(p.id);
          const positions = [
            "bottom-6 left-1/2 -translate-x-1/2",
            "top-1/2 right-4 -translate-y-1/2",
            "top-6 left-1/2 -translate-x-1/2",
            "top-1/2 left-4 -translate-y-1/2",
          ];
          return (
            <Avatar
              key={p.id}
              player={p}
              pos={positions[viewSeat]}
              active={toViewSeat(state.turnIndex ?? 0) === viewSeat}
              phase={phase}
              gameType={gameType}
              turnProgress={gameType === 'CALLBREAK' && state.status === 'PLAYING' && toViewSeat(state.turnIndex ?? 0) === viewSeat ? Math.max(
                0,
                Math.min(
                  1,
                  (state.turnDeadlineMs - clockMs) /
                    getOnlineTurnDurationMs(gameType, !!(state.players?.[state.turnIndex ?? 0]?.isBot || state.players?.[state.turnIndex ?? 0]?.disconnected))
                )
              ) : undefined}
            />
          );
        })}

        {/* Trick Area */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[20rem] h-[20rem] flex items-center justify-center pointer-events-none">
          <div className="flex gap-3 justify-center min-h-[86px] items-center relative">
            {renderTrick.length === 0 ? (
              <span className="text-xs text-white/50">
                {phase === 'WAITING' ? 'Waiting for players...' :
                 phase === 'PASSING' ? 'Passing cards...' :
                 phase === 'BIDDING' ? 'Placing bids...' :
                 'Waiting for first card...'}
              </span>
            ) : renderTrick.map((t, idx) => {
              const trickViewSeat = toViewSeat(t.seat);
              const winnerViewSeat = toViewSeat(clearingTrickWinner ?? toGlobalSeat(0));
              const off = [{ x: 0, y: 45 }, { x: 60, y: 0 }, { x: 0, y: -45 }, { x: -60, y: 0 }][trickViewSeat] || { x: 0, y: 0 };
              const startPos = [{ x: 0, y: 350 }, { x: 400, y: 0 }, { x: 0, y: -350 }, { x: -400, y: 0 }][trickViewSeat] || { x: 0, y: 0 };
              const winDir = [{ x: 0, y: 600 }, { x: 500, y: 0 }, { x: 0, y: -600 }, { x: -500, y: 0 }][winnerViewSeat] || { x: 0, y: 0 };
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
                    animationDuration: clearingTrickWinner !== null ? '800ms' : '360ms',
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

      {/* Hand Area */}
      <div className="h-[20%] w-full relative flex flex-col items-center justify-end pb-[max(1rem,var(--safe-bottom))] z-40 bg-gradient-to-t from-black via-black/40 to-transparent">
        <div className="relative w-full flex-1">
          {handLayout.map((item, idx, arr) => (
            <button
              key={item.card.id}
              onClick={() => {
                if (phase === 'PASSING') togglePassCard(item.card.id);
                else submitCard(item.card.id);
              }}
              disabled={state.status !== 'PLAYING' || (phase !== 'PLAYING' && phase !== 'PASSING')}
              className={`absolute card-fan-item animate-deal ${state.turnIndex === selfSeat ? 'cursor-pointer active:-translate-y-2' : 'opacity-70 cursor-default'}`}
              style={{
                transform: `translate3d(${item.x}px, ${Math.pow(idx - (arr.length - 1) / 2, 2) * 0.32 + (phase === 'PASSING' && selectedPassIds.includes(item.card.id) ? -80 : 0)}px, 0) rotate(${(idx - (arr.length - 1) / 2) * 1.5}deg)`,
                zIndex: 100 + idx,
              }}
            >
              <CardView
                card={item.card}
                size="lg"
                inactive={phase === 'PLAYING' && state.turnIndex === selfSeat && state.status === 'PLAYING' && !playableIds.has(item.card.id)}
                highlighted={phase === 'PASSING' && selectedPassIds.includes(item.card.id)}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Passing Confirmation */}
      {phase === 'PASSING' && !passingConfirmed && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-[150]">
          <button
            onClick={confirmPass}
            disabled={selectedPassIds.length !== 3}
            className={`px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-sm ${selectedPassIds.length === 3 ? 'bg-yellow-500 text-black' : 'bg-white/10 text-white/50 border border-white/20'}`}
          >
            Confirm Pass ({selectedPassIds.length}/3)
          </button>
        </div>
      )}

      {/* Bidding Interface */}
      {phase === 'BIDDING' && state.turnIndex === selfSeat && biddingValue === null && (
        <div className="absolute left-1/2 -translate-x-1/2 z-[180] bg-black/75 border border-white/15 rounded-2xl p-3"
          style={{ bottom: 'calc(max(1rem, var(--safe-bottom)) + 150px)' }}>
          <div className="text-[10px] text-white/60 font-black uppercase tracking-widest mb-2 text-center">Select Bid</div>
          <div className={`grid gap-2 ${gameType === 'SPADES' ? 'grid-cols-5' : 'grid-cols-4'}`}>
            {(gameType === 'SPADES' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] : [1, 2, 3, 4, 5, 6, 7, 8]).map((b) => (
              <button key={b} onClick={() => submitBid(b)} className="w-10 h-10 rounded-xl bg-yellow-500 text-black font-black">
                {b}
              </button>
            ))}
          </div>
        </div>
      )}

      {result && <div className="mt-2 text-center text-sm font-black text-green-400">{result}</div>}

      {/* Debug Overlay */}
      {showDebugOverlay && (
        <div className="absolute left-2 top-[calc(var(--safe-top)+3.25rem)] z-[300] bg-black/85 border border-cyan-400/60 rounded-lg px-3 py-2 text-[10px] leading-4 font-mono text-cyan-200 max-w-[95vw] max-h-[45vh] overflow-auto">
          <div>match: {String(syncDebug.matchId || 'NA')}</div>
          <div>seat: {syncDebug.seat} rev: {syncDebug.revision} evt: {syncDebug.lastEventId}</div>
          <div>status: {String(syncDebug.status)} phase: {String(syncDebug.phase)} turn: {syncDebug.turnIndex}</div>
          <div>sub: {String(syncDebug.subscriptionId || 'NA')}</div>
          <div>pump: {String(syncDebug.eventPumpRunning)} inflight: {String(syncDebug.eventPumpInFlight)} empty: {syncDebug.emptyEventLoops}</div>
          <div className="text-[9px] text-cyan-400/80">tap title 5x to hide</div>
        </div>
      )}
    </div>
  );
}