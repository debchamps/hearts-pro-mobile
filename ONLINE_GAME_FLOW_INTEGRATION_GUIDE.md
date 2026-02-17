# Online Game Flow Integration Guide

This guide provides step-by-step instructions to fix the online game flow issues for Hearts, Spades, and Callbreak games.

## 🎯 Overview of Issues Fixed

### Hearts Game Flow
- ✅ Proper passing phase implementation
- ✅ Card passing direction handling (LEFT, RIGHT, ACROSS, NONE)
- ✅ Synchronized passing completion across all players
- ✅ Smooth transition from passing to playing phase

### Spades/Callbreak Game Flow
- ✅ Complete bidding phase implementation
- ✅ Turn-based bidding with proper validation
- ✅ Nil bid handling for Spades
- ✅ Bid range validation (0-13 for Spades, 1-8 for Callbreak)
- ✅ Smooth transition from bidding to playing phase

### General Improvements
- ✅ Enhanced phase management and transitions
- ✅ Proper event synchronization across all players
- ✅ Timeout handling for each phase
- ✅ Comprehensive error handling and recovery

## 🚀 Implementation Steps

### Step 1: Update Server-Side Handlers

Replace the existing PlayFab CloudScript handlers with the enhanced version:

```javascript
// Copy the content from server/playfab/cloudscript/enhanced-handlers.js
// to your PlayFab CloudScript deployment
```

Key improvements in the enhanced handlers:
- **Phase Management**: Proper state transitions between WAITING → PASSING/BIDDING → PLAYING → COMPLETED
- **Event System**: Enhanced event emission for phase changes and player actions
- **Timeout Handling**: Phase-specific timeout logic with auto-completion
- **Validation**: Comprehensive input validation for each phase

### Step 2: Update Client-Side Game Screen

Replace the existing `OnlineGameScreen.tsx` with the enhanced version:

```typescript
// Use client/EnhancedOnlineGameScreen.tsx as the new implementation
```

Key improvements in the enhanced client:
- **Phase-Aware UI**: Different interfaces for passing, bidding, and playing phases
- **State Synchronization**: Better handling of game state updates
- **User Feedback**: Clear messages and visual indicators for each phase
- **Error Recovery**: Improved error handling and state recovery

### Step 3: Update Game Types and Interfaces

Add the enhanced types to support the new phase management:

```typescript
// Add to types.ts
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
```

### Step 4: Update Multiplayer Service

Enhance the `MultiplayerService` to handle the new phase-specific operations:

```typescript
// Add these methods to MultiplayerService
async submitPass(cardIds: string[]): Promise<MultiplayerGameState> {
  // Implementation for card passing
}

async submitBid(bid: number): Promise<MultiplayerGameState> {
  // Implementation for bidding
}
```

### Step 5: Testing and Validation

Use the provided testing tools to validate the implementation:

#### A. Game Flow Simulator
```typescript
import { GameFlowSimulator } from './tools/GameFlowSimulator';

// Use the simulator to test game flows
<GameFlowSimulator gameType="HEARTS" onClose={() => {}} />
```

#### B. Automated Tests
```typescript
import { gameFlowTester } from './tests/OnlineGameFlowTests';

// Run all tests
await gameFlowTester.runAllTests();

// Run specific game type tests
await gameFlowTester.runGameTypeTests('HEARTS');
```

## 🔧 Configuration Updates

### PlayFab Configuration

Update your PlayFab title settings:

```json
{
  "HUMAN_TIMEOUT_MS": 9000,
  "BOT_TIMEOUT_MS": 900,
  "PASSING_TIMEOUT_MS": 15000,
  "BIDDING_TIMEOUT_MS": 12000,
  "CALLBREAK_HUMAN_TIMEOUT_EXTRA_MS": 5000
}
```

### Client Configuration

Update the online configuration:

```typescript
// client/online/config.ts
export const ONLINE_PASSING_TIMEOUT_MS = 15000;
export const ONLINE_BIDDING_TIMEOUT_MS = 12000;

export function getPhaseTimeoutMs(gameType: GameType, phase: string): number {
  switch (phase) {
    case 'PASSING': return ONLINE_PASSING_TIMEOUT_MS;
    case 'BIDDING': return ONLINE_BIDDING_TIMEOUT_MS;
    case 'PLAYING': return getOnlineTurnDurationMs(gameType, false);
    default: return ONLINE_HUMAN_TIMEOUT_MS;
  }
}
```

## 🎮 Game Flow Comparison

### Before (Broken Flow)
```
HEARTS: WAITING → PLAYING (missing passing phase)
SPADES: WAITING → PLAYING (missing bidding phase)
CALLBREAK: WAITING → PLAYING (missing bidding phase)
```

### After (Fixed Flow)
```
HEARTS: WAITING → PASSING → PLAYING → COMPLETED
SPADES: WAITING → BIDDING → PLAYING → COMPLETED
CALLBREAK: WAITING → BIDDING → PLAYING → COMPLETED
```

## 🔍 Key Features Implemented

### Hearts Passing Phase
- **Card Selection**: Players select 3 cards to pass
- **Direction Handling**: LEFT, RIGHT, ACROSS, or NONE based on round
- **Synchronization**: All players must complete passing before proceeding
- **Auto-completion**: Timeout handling with automatic card selection

### Spades/Callbreak Bidding Phase
- **Turn-based Bidding**: Players bid in sequence
- **Validation**: Proper bid range validation
- **Nil Bids**: Special handling for Spades nil bids
- **Auto-bidding**: Timeout handling with automatic bid selection

### Enhanced UI Components
- **Phase Indicators**: Clear visual indication of current phase
- **Progress Tracking**: Show completion status for each player
- **Interactive Elements**: Phase-specific UI components
- **Error Feedback**: Clear error messages and recovery options

## 🧪 Testing Checklist

Before deploying, ensure all these scenarios work correctly:

### Hearts Testing
- [ ] Passing phase starts correctly when game begins
- [ ] All players can select and confirm 3 cards to pass
- [ ] Cards are distributed correctly based on passing direction
- [ ] Game transitions to playing phase after all players pass
- [ ] Timeout handling works for incomplete passing
- [ ] 2 of Clubs leads the first trick after passing

### Spades Testing
- [ ] Bidding phase starts correctly when game begins
- [ ] Players can bid in turn (0-13 range)
- [ ] Nil bids are handled correctly
- [ ] Game transitions to playing phase after all players bid
- [ ] Timeout handling works for incomplete bidding
- [ ] Team scoring works correctly with bids

### Callbreak Testing
- [ ] Bidding phase starts correctly when game begins
- [ ] Players can bid in turn (1-8 range)
- [ ] Game transitions to playing phase after all players bid
- [ ] Spades trump rules work correctly
- [ ] Timeout handling works for incomplete bidding
- [ ] Individual scoring works correctly with bids

### General Testing
- [ ] All players see consistent game state
- [ ] Phase transitions are synchronized across players
- [ ] Error recovery works correctly
- [ ] Network interruptions are handled gracefully
- [ ] Bot players work correctly in all phases

## 🚨 Common Issues and Solutions

### Issue: Players stuck in passing/bidding phase
**Solution**: Check timeout handling and ensure all players complete their actions

### Issue: Inconsistent game state across players
**Solution**: Verify event synchronization and state update logic

### Issue: UI not updating correctly
**Solution**: Check phase detection logic and component re-rendering

### Issue: Bots not participating in phases
**Solution**: Ensure bot auto-actions are implemented for all phases

## 📈 Performance Considerations

- **Event Batching**: Group related events to reduce network traffic
- **State Compression**: Only send changed state data
- **Timeout Optimization**: Use appropriate timeouts for different phases
- **Error Recovery**: Implement graceful degradation for network issues

## 🎉 Deployment

1. **Deploy Server Changes**: Update PlayFab CloudScript with enhanced handlers
2. **Deploy Client Changes**: Update the client application with enhanced components
3. **Test Thoroughly**: Run all test suites to ensure functionality
4. **Monitor**: Watch for any issues in production and be ready to rollback if needed

## 📞 Support

If you encounter issues during implementation:

1. **Check Logs**: Review both client and server logs for errors
2. **Run Tests**: Use the provided test suite to identify specific issues
3. **Use Simulator**: The game flow simulator can help debug complex scenarios
4. **Validate State**: Ensure game state is consistent across all players

The enhanced online game flow should now match the offline game behavior while providing a smooth multiplayer experience for all supported game types.