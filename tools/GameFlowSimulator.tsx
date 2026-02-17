import React, { useState, useEffect, useRef } from 'react';
import { GameType, Player, Card, GameState } from '../types';
import { createDeck, shuffle } from '../constants';
import { sortCardsBySuitThenRankAsc } from '../services/cardSort';

interface SimulationStep {
  step: number;
  phase: string;
  action: string;
  player?: number;
  data?: any;
  timestamp: number;
}

interface SimulationState {
  gameType: GameType;
  phase: 'WAITING' | 'PASSING' | 'BIDDING' | 'PLAYING' | 'COMPLETED';
  players: Player[];
  hands: Record<number, Card[]>;
  currentTrick: Array<{ seat: number; card: Card }>;
  turnIndex: number;
  leadSuit: string | null;
  scores: Record<number, number>;
  bids: Record<number, number | null>;
  tricksWon: Record<number, number>;
  roundNumber: number;
  passingSelections: Record<number, string[]>;
  passingDirection: 'LEFT' | 'RIGHT' | 'ACROSS' | 'NONE';
  heartsBroken: boolean;
  spadesBroken: boolean;
}

export function GameFlowSimulator({ gameType, onClose }: { gameType: GameType; onClose: () => void }) {
  const [simulationState, setSimulationState] = useState<SimulationState | null>(null);
  const [simulationSteps, setSimulationSteps] = useState<SimulationStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [speed, setSpeed] = useState(1000); // ms between steps
  const [autoRun, setAutoRun] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const initializeSimulation = () => {
    const players: Player[] = [
      { id: 0, name: 'Human Player', avatar: '👤', hand: [], score: 0, currentRoundScore: 0, isHuman: true, tricksWon: 0 },
      { id: 1, name: 'Bot 1', avatar: '🤖', hand: [], score: 0, currentRoundScore: 0, isHuman: false, tricksWon: 0 },
      { id: 2, name: 'Opponent', avatar: '🧑', hand: [], score: 0, currentRoundScore: 0, isHuman: true, tricksWon: 0 },
      { id: 3, name: 'Bot 3', avatar: '🤖', hand: [], score: 0, currentRoundScore: 0, isHuman: false, tricksWon: 0 }
    ];

    const deck = shuffle(createDeck({ targetScore: 100, shootTheMoon: false, noPassing: false, jackOfDiamonds: false }));
    const hands: Record<number, Card[]> = {};
    
    for (let seat = 0; seat < 4; seat++) {
      hands[seat] = sortCardsBySuitThenRankAsc(deck.slice(seat * 13, seat * 13 + 13));
      players[seat].hand = hands[seat];
    }

    const initialPhase = gameType === 'HEARTS' ? 'PASSING' : 
                        (gameType === 'SPADES' || gameType === 'CALLBREAK') ? 'BIDDING' : 'PLAYING';

    const state: SimulationState = {
      gameType,
      phase: initialPhase,
      players,
      hands,
      currentTrick: [],
      turnIndex: 0,
      leadSuit: null,
      scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
      bids: { 0: null, 1: null, 2: null, 3: null },
      tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
      roundNumber: 1,
      passingSelections: { 0: [], 1: [], 2: [], 3: [] },
      passingDirection: 'LEFT',
      heartsBroken: false,
      spadesBroken: false
    };

    setSimulationState(state);
    setSimulationSteps([{
      step: 0,
      phase: initialPhase,
      action: 'Game initialized',
      timestamp: Date.now(),
      data: { gameType, phase: initialPhase }
    }]);
    setCurrentStep(0);
  };

  const simulatePassingPhase = (state: SimulationState): SimulationStep[] => {
    const steps: SimulationStep[] = [];
    let stepCount = simulationSteps.length;

    // Simulate each player passing cards
    for (let seat = 0; seat < 4; seat++) {
      const hand = state.hands[seat];
      // Select 3 cards to pass (prioritize high hearts and Queen of Spades)
      const cardsToPass = hand
        .slice()
        .sort((a, b) => {
          if (a.id === 'Q-SPADES') return -1;
          if (b.id === 'Q-SPADES') return 1;
          if (a.suit === 'HEARTS' && b.suit !== 'HEARTS') return -1;
          if (b.suit === 'HEARTS' && a.suit !== 'HEARTS') return 1;
          return b.value - a.value;
        })
        .slice(0, 3);

      state.passingSelections[seat] = cardsToPass.map(c => c.id);
      
      steps.push({
        step: ++stepCount,
        phase: 'PASSING',
        action: `Player ${seat} selected cards to pass`,
        player: seat,
        timestamp: Date.now(),
        data: { 
          cards: cardsToPass.map(c => c.id),
          direction: state.passingDirection
        }
      });
    }

    // Execute the passing
    const passes: Record<number, Card[]> = {};
    for (let seat = 0; seat < 4; seat++) {
      const selectedIds = state.passingSelections[seat];
      passes[seat] = selectedIds.map(id => 
        state.hands[seat].find(c => c.id === id)
      ).filter(Boolean) as Card[];
      
      // Remove passed cards from hand
      state.hands[seat] = state.hands[seat].filter(c => !selectedIds.includes(c.id));
    }

    // Distribute passed cards
    for (let seat = 0; seat < 4; seat++) {
      const targetSeat = (seat + 1) % 4; // LEFT direction
      state.hands[targetSeat] = [...state.hands[targetSeat], ...passes[seat]];
    }

    // Re-sort hands
    for (let seat = 0; seat < 4; seat++) {
      state.hands[seat] = sortCardsBySuitThenRankAsc(state.hands[seat]);
      state.players[seat].hand = state.hands[seat];
    }

    steps.push({
      step: ++stepCount,
      phase: 'PASSING',
      action: 'Cards passed and redistributed',
      timestamp: Date.now(),
      data: { direction: state.passingDirection }
    });

    // Transition to playing phase
    state.phase = 'PLAYING';
    state.turnIndex = 0; // Find player with 2 of clubs
    for (let seat = 0; seat < 4; seat++) {
      if (state.hands[seat].some(c => c.id === '2-CLUBS')) {
        state.turnIndex = seat;
        break;
      }
    }

    steps.push({
      step: ++stepCount,
      phase: 'PLAYING',
      action: 'Transitioned to playing phase',
      timestamp: Date.now(),
      data: { startingPlayer: state.turnIndex }
    });

    return steps;
  };

  const simulateBiddingPhase = (state: SimulationState): SimulationStep[] => {
    const steps: SimulationStep[] = [];
    let stepCount = simulationSteps.length;

    // Simulate each player bidding
    for (let seat = 0; seat < 4; seat++) {
      const hand = state.hands[seat];
      let bid: number;

      if (gameType === 'CALLBREAK') {
        // Simple bidding logic for Callbreak (1-8)
        const spades = hand.filter(c => c.suit === 'SPADES').length;
        const highCards = hand.filter(c => c.value >= 12).length;
        bid = Math.max(1, Math.min(8, Math.floor((spades + highCards) / 2)));
      } else {
        // Spades bidding logic (0-13)
        const spades = hand.filter(c => c.suit === 'SPADES').length;
        const aces = hand.filter(c => c.value === 14).length;
        const kings = hand.filter(c => c.value === 13).length;
        bid = Math.max(0, Math.min(13, spades + aces + kings - 3));
      }

      state.bids[seat] = bid;
      
      steps.push({
        step: ++stepCount,
        phase: 'BIDDING',
        action: `Player ${seat} bid ${bid}`,
        player: seat,
        timestamp: Date.now(),
        data: { bid, totalBid: Object.values(state.bids).reduce((sum, b) => sum + (b || 0), 0) }
      });
    }

    // Transition to playing phase
    state.phase = 'PLAYING';
    state.turnIndex = 0;

    steps.push({
      step: ++stepCount,
      phase: 'PLAYING',
      action: 'Bidding complete, starting play',
      timestamp: Date.now(),
      data: { bids: state.bids }
    });

    return steps;
  };

  const simulatePlayingPhase = (state: SimulationState): SimulationStep[] => {
    const steps: SimulationStep[] = [];
    let stepCount = simulationSteps.length;

    // Simulate a few tricks
    for (let trickNum = 0; trickNum < 3 && state.hands[0].length > 0; trickNum++) {
      // Play 4 cards for this trick
      for (let cardNum = 0; cardNum < 4; cardNum++) {
        const currentPlayer = state.turnIndex;
        const hand = state.hands[currentPlayer];
        
        if (hand.length === 0) break;

        // Simple card selection logic
        let cardToPlay: Card;
        if (state.currentTrick.length === 0) {
          // Leading - play lowest card
          cardToPlay = hand.reduce((lowest, card) => 
            card.value < lowest.value ? card : lowest
          );
        } else {
          // Following - try to follow suit
          const leadSuit = state.leadSuit;
          const followCards = hand.filter(c => c.suit === leadSuit);
          if (followCards.length > 0) {
            cardToPlay = followCards[0];
          } else {
            cardToPlay = hand[0];
          }
        }

        // Play the card
        state.hands[currentPlayer] = hand.filter(c => c.id !== cardToPlay.id);
        state.players[currentPlayer].hand = state.hands[currentPlayer];
        state.currentTrick.push({ seat: currentPlayer, card: cardToPlay });

        if (state.currentTrick.length === 1) {
          state.leadSuit = cardToPlay.suit;
        }

        // Update broken suits
        if (cardToPlay.suit === 'HEARTS') state.heartsBroken = true;
        if (cardToPlay.suit === 'SPADES') state.spadesBroken = true;

        steps.push({
          step: ++stepCount,
          phase: 'PLAYING',
          action: `Player ${currentPlayer} played ${cardToPlay.rank} of ${cardToPlay.suit}`,
          player: currentPlayer,
          timestamp: Date.now(),
          data: { 
            card: cardToPlay,
            trickLength: state.currentTrick.length,
            leadSuit: state.leadSuit
          }
        });

        // Advance turn
        state.turnIndex = (state.turnIndex + 1) % 4;
      }

      // Resolve trick winner
      if (state.currentTrick.length === 4) {
        let winner = state.currentTrick[0];
        const leadSuit = state.leadSuit;
        const trumpSuit = gameType === 'HEARTS' ? null : 'SPADES';

        for (let i = 1; i < state.currentTrick.length; i++) {
          const current = state.currentTrick[i];
          const winnerIsTrump = trumpSuit && winner.card.suit === trumpSuit;
          const currentIsTrump = trumpSuit && current.card.suit === trumpSuit;

          if (currentIsTrump && !winnerIsTrump) {
            winner = current;
          } else if (currentIsTrump === winnerIsTrump) {
            const compareSuit = winnerIsTrump ? trumpSuit : leadSuit;
            if (current.card.suit === compareSuit && 
                winner.card.suit === compareSuit && 
                current.card.value > winner.card.value) {
              winner = current;
            }
          }
        }

        // Update scores
        const trickPoints = state.currentTrick.reduce((sum, play) => 
          sum + (play.card.points || 0), 0
        );
        state.scores[winner.seat] += trickPoints;
        state.tricksWon[winner.seat]++;

        steps.push({
          step: ++stepCount,
          phase: 'PLAYING',
          action: `Player ${winner.seat} won the trick`,
          player: winner.seat,
          timestamp: Date.now(),
          data: { 
            winner: winner.seat,
            points: trickPoints,
            trick: state.currentTrick
          }
        });

        // Clear trick and set next leader
        state.currentTrick = [];
        state.leadSuit = null;
        state.turnIndex = winner.seat;
      }
    }

    return steps;
  };

  const runSimulationStep = () => {
    if (!simulationState) return;

    const newSteps: SimulationStep[] = [];
    
    switch (simulationState.phase) {
      case 'PASSING':
        if (gameType === 'HEARTS') {
          newSteps.push(...simulatePassingPhase(simulationState));
        }
        break;
      case 'BIDDING':
        if (gameType === 'SPADES' || gameType === 'CALLBREAK') {
          newSteps.push(...simulateBiddingPhase(simulationState));
        }
        break;
      case 'PLAYING':
        newSteps.push(...simulatePlayingPhase(simulationState));
        break;
    }

    if (newSteps.length > 0) {
      setSimulationSteps(prev => [...prev, ...newSteps]);
      setCurrentStep(prev => prev + newSteps.length);
    }
  };

  const startAutoRun = () => {
    setAutoRun(true);
    setIsRunning(true);
    intervalRef.current = window.setInterval(() => {
      runSimulationStep();
    }, speed);
  };

  const stopAutoRun = () => {
    setAutoRun(false);
    setIsRunning(false);
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const resetSimulation = () => {
    stopAutoRun();
    setSimulationState(null);
    setSimulationSteps([]);
    setCurrentStep(0);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]">
      <div className="bg-gray-900 rounded-2xl p-6 max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-black text-white">
            {gameType} Game Flow Simulator
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white font-black"
          >
            ×
          </button>
        </div>

        <div className="flex gap-4 mb-4">
          <button
            onClick={initializeSimulation}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-bold"
          >
            Initialize
          </button>
          <button
            onClick={runSimulationStep}
            disabled={!simulationState || isRunning}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-bold disabled:opacity-50"
          >
            Step
          </button>
          <button
            onClick={isRunning ? stopAutoRun : startAutoRun}
            disabled={!simulationState}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg font-bold disabled:opacity-50"
          >
            {isRunning ? 'Stop' : 'Auto Run'}
          </button>
          <button
            onClick={resetSimulation}
            className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold"
          >
            Reset
          </button>
          <div className="flex items-center gap-2">
            <label className="text-white text-sm">Speed:</label>
            <input
              type="range"
              min="100"
              max="3000"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-20"
            />
            <span className="text-white text-sm">{speed}ms</span>
          </div>
        </div>

        {simulationState && (
          <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden">
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-bold text-white mb-2">Game State</h3>
              <div className="text-sm text-gray-300 space-y-1">
                <div>Phase: <span className="text-yellow-400">{simulationState.phase}</span></div>
                <div>Turn: <span className="text-blue-400">Player {simulationState.turnIndex}</span></div>
                <div>Round: <span className="text-green-400">{simulationState.roundNumber}</span></div>
                {simulationState.leadSuit && (
                  <div>Lead Suit: <span className="text-red-400">{simulationState.leadSuit}</span></div>
                )}
                <div className="mt-2">
                  <div className="text-white font-bold">Scores:</div>
                  {Object.entries(simulationState.scores).map(([seat, score]) => (
                    <div key={seat}>
                      Player {seat}: {score} 
                      {simulationState.bids[Number(seat)] !== null && (
                        <span className="text-gray-400"> (bid: {simulationState.bids[Number(seat)]})</span>
                      )}
                    </div>
                  ))}
                </div>
                {simulationState.currentTrick.length > 0 && (
                  <div className="mt-2">
                    <div className="text-white font-bold">Current Trick:</div>
                    {simulationState.currentTrick.map((play, idx) => (
                      <div key={idx}>
                        Player {play.seat}: {play.card.rank} of {play.card.suit}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4 overflow-hidden">
              <h3 className="text-lg font-bold text-white mb-2">
                Simulation Steps ({simulationSteps.length})
              </h3>
              <div className="overflow-y-auto h-full text-sm text-gray-300 space-y-1">
                {simulationSteps.map((step, idx) => (
                  <div
                    key={step.step}
                    className={`p-2 rounded ${idx === currentStep - 1 ? 'bg-blue-600' : 'bg-gray-700'}`}
                  >
                    <div className="font-bold">
                      Step {step.step}: {step.action}
                    </div>
                    <div className="text-xs text-gray-400">
                      Phase: {step.phase}
                      {step.player !== undefined && ` | Player: ${step.player}`}
                    </div>
                    {step.data && (
                      <div className="text-xs text-gray-500 mt-1">
                        {JSON.stringify(step.data, null, 2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 text-center text-gray-400 text-sm">
          This simulator helps validate that online game flow matches offline behavior
        </div>
      </div>
    </div>
  );
}