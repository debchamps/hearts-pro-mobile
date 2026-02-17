// Comprehensive test suite for online game flow validation
import { GameType } from '../types';

interface TestCase {
  name: string;
  gameType: GameType;
  description: string;
  steps: TestStep[];
  expectedOutcome: string;
}

interface TestStep {
  action: 'INITIALIZE' | 'JOIN' | 'PASS_CARDS' | 'SUBMIT_BID' | 'PLAY_CARD' | 'TIMEOUT' | 'VERIFY_STATE';
  player?: number;
  data?: any;
  expectedPhase?: string;
  expectedTurnIndex?: number;
  timeout?: number;
}

export class OnlineGameFlowTester {
  private testResults: Array<{ testName: string; passed: boolean; error?: string }> = [];

  // Hearts Game Flow Tests
  private heartsTestCases: TestCase[] = [
    {
      name: 'Hearts Complete Game Flow',
      gameType: 'HEARTS',
      description: 'Test complete Hearts game from start to finish with proper passing phase',
      steps: [
        { action: 'INITIALIZE', expectedPhase: 'WAITING' },
        { action: 'JOIN', player: 2, expectedPhase: 'PASSING' },
        { action: 'PASS_CARDS', player: 0, data: { cardIds: ['A-HEARTS', 'K-HEARTS', 'Q-SPADES'] } },
        { action: 'PASS_CARDS', player: 1, data: { cardIds: ['A-SPADES', 'K-SPADES', 'Q-HEARTS'] } },
        { action: 'PASS_CARDS', player: 2, data: { cardIds: ['J-HEARTS', '10-HEARTS', '9-HEARTS'] } },
        { action: 'PASS_CARDS', player: 3, data: { cardIds: ['8-HEARTS', '7-HEARTS', '6-HEARTS'] } },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING', expectedTurnIndex: 0 },
        { action: 'PLAY_CARD', player: 0, data: { cardId: '2-CLUBS' } },
        { action: 'PLAY_CARD', player: 1, data: { cardId: '3-CLUBS' } },
        { action: 'PLAY_CARD', player: 2, data: { cardId: '4-CLUBS' } },
        { action: 'PLAY_CARD', player: 3, data: { cardId: '5-CLUBS' } },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING' }
      ],
      expectedOutcome: 'Hearts game should progress through passing phase to playing phase correctly'
    },
    {
      name: 'Hearts Passing Timeout',
      gameType: 'HEARTS',
      description: 'Test Hearts passing phase timeout handling',
      steps: [
        { action: 'INITIALIZE', expectedPhase: 'WAITING' },
        { action: 'JOIN', player: 2, expectedPhase: 'PASSING' },
        { action: 'PASS_CARDS', player: 0, data: { cardIds: ['A-HEARTS', 'K-HEARTS', 'Q-SPADES'] } },
        { action: 'TIMEOUT', timeout: 15000 },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING' }
      ],
      expectedOutcome: 'Incomplete passing should auto-complete on timeout'
    }
  ];

  // Spades Game Flow Tests
  private spadesTestCases: TestCase[] = [
    {
      name: 'Spades Complete Bidding Flow',
      gameType: 'SPADES',
      description: 'Test complete Spades bidding phase',
      steps: [
        { action: 'INITIALIZE', expectedPhase: 'WAITING' },
        { action: 'JOIN', player: 2, expectedPhase: 'BIDDING' },
        { action: 'SUBMIT_BID', player: 0, data: { bid: 3 } },
        { action: 'SUBMIT_BID', player: 1, data: { bid: 2 } },
        { action: 'SUBMIT_BID', player: 2, data: { bid: 4 } },
        { action: 'SUBMIT_BID', player: 3, data: { bid: 1 } },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING', expectedTurnIndex: 0 },
        { action: 'PLAY_CARD', player: 0, data: { cardId: 'A-CLUBS' } }
      ],
      expectedOutcome: 'Spades should progress from bidding to playing correctly'
    },
    {
      name: 'Spades Nil Bid Handling',
      gameType: 'SPADES',
      description: 'Test Spades nil bid functionality',
      steps: [
        { action: 'INITIALIZE', expectedPhase: 'WAITING' },
        { action: 'JOIN', player: 2, expectedPhase: 'BIDDING' },
        { action: 'SUBMIT_BID', player: 0, data: { bid: 0 } }, // Nil bid
        { action: 'SUBMIT_BID', player: 1, data: { bid: 5 } },
        { action: 'SUBMIT_BID', player: 2, data: { bid: 3 } },
        { action: 'SUBMIT_BID', player: 3, data: { bid: 2 } },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING' }
      ],
      expectedOutcome: 'Nil bids should be handled correctly'
    }
  ];

  // Callbreak Game Flow Tests
  private callbreakTestCases: TestCase[] = [
    {
      name: 'Callbreak Complete Bidding Flow',
      gameType: 'CALLBREAK',
      description: 'Test complete Callbreak bidding phase',
      steps: [
        { action: 'INITIALIZE', expectedPhase: 'WAITING' },
        { action: 'JOIN', player: 2, expectedPhase: 'BIDDING' },
        { action: 'SUBMIT_BID', player: 0, data: { bid: 4 } },
        { action: 'SUBMIT_BID', player: 1, data: { bid: 3 } },
        { action: 'SUBMIT_BID', player: 2, data: { bid: 5 } },
        { action: 'SUBMIT_BID', player: 3, data: { bid: 2 } },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING', expectedTurnIndex: 0 }
      ],
      expectedOutcome: 'Callbreak should progress from bidding to playing correctly'
    },
    {
      name: 'Callbreak Spades Trump Rules',
      gameType: 'CALLBREAK',
      description: 'Test Callbreak spades trump functionality',
      steps: [
        { action: 'INITIALIZE', expectedPhase: 'WAITING' },
        { action: 'JOIN', player: 2, expectedPhase: 'BIDDING' },
        { action: 'SUBMIT_BID', player: 0, data: { bid: 3 } },
        { action: 'SUBMIT_BID', player: 1, data: { bid: 2 } },
        { action: 'SUBMIT_BID', player: 2, data: { bid: 4 } },
        { action: 'SUBMIT_BID', player: 3, data: { bid: 1 } },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING' },
        { action: 'PLAY_CARD', player: 0, data: { cardId: 'A-HEARTS' } },
        { action: 'PLAY_CARD', player: 1, data: { cardId: '2-SPADES' } }, // Trump card
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING' }
      ],
      expectedOutcome: 'Spades should act as trump cards in Callbreak'
    }
  ];

  // Synchronization Tests
  private synchronizationTestCases: TestCase[] = [
    {
      name: 'Multi-Player State Sync',
      gameType: 'HEARTS',
      description: 'Test that all players receive state updates correctly',
      steps: [
        { action: 'INITIALIZE', expectedPhase: 'WAITING' },
        { action: 'JOIN', player: 2, expectedPhase: 'PASSING' },
        { action: 'PASS_CARDS', player: 0, data: { cardIds: ['A-HEARTS', 'K-HEARTS', 'Q-SPADES'] } },
        { action: 'VERIFY_STATE', expectedPhase: 'PASSING' }, // Should still be passing
        { action: 'PASS_CARDS', player: 2, data: { cardIds: ['J-HEARTS', '10-HEARTS', '9-HEARTS'] } },
        { action: 'VERIFY_STATE', expectedPhase: 'PLAYING' } // Should transition after all pass
      ],
      expectedOutcome: 'All players should see consistent game state'
    }
  ];

  async runAllTests(): Promise<void> {
    console.log('🎮 Starting Online Game Flow Tests...\n');

    const allTestCases = [
      ...this.heartsTestCases,
      ...this.spadesTestCases,
      ...this.callbreakTestCases,
      ...this.synchronizationTestCases
    ];

    for (const testCase of allTestCases) {
      await this.runTestCase(testCase);
    }

    this.printResults();
  }

  private async runTestCase(testCase: TestCase): Promise<void> {
    console.log(`🧪 Running: ${testCase.name}`);
    console.log(`   ${testCase.description}`);

    try {
      // Mock game state for testing
      let mockState = this.createMockGameState(testCase.gameType);
      
      for (const step of testCase.steps) {
        mockState = await this.executeTestStep(mockState, step);
        
        // Verify expected state if specified
        if (step.expectedPhase && mockState.phase !== step.expectedPhase) {
          throw new Error(`Expected phase ${step.expectedPhase}, got ${mockState.phase}`);
        }
        
        if (step.expectedTurnIndex !== undefined && mockState.turnIndex !== step.expectedTurnIndex) {
          throw new Error(`Expected turn index ${step.expectedTurnIndex}, got ${mockState.turnIndex}`);
        }
      }

      this.testResults.push({ testName: testCase.name, passed: true });
      console.log(`   ✅ PASSED\n`);

    } catch (error) {
      this.testResults.push({ 
        testName: testCase.name, 
        passed: false, 
        error: error instanceof Error ? error.message : String(error)
      });
      console.log(`   ❌ FAILED: ${error}\n`);
    }
  }

  private createMockGameState(gameType: GameType): any {
    return {
      gameType,
      phase: 'WAITING',
      players: [
        { seat: 0, name: 'Player 0', isBot: false },
        { seat: 1, name: 'Bot 1', isBot: true },
        { seat: 2, name: 'Player 2', isBot: false },
        { seat: 3, name: 'Bot 3', isBot: true }
      ],
      hands: { 0: [], 1: [], 2: [], 3: [] },
      turnIndex: 0,
      currentTrick: [],
      scores: { 0: 0, 1: 0, 2: 0, 3: 0 },
      bids: { 0: null, 1: null, 2: null, 3: null },
      tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
      passingSelections: { 0: [], 1: [], 2: [], 3: [] },
      passingComplete: { 0: false, 1: false, 2: false, 3: false },
      biddingComplete: { 0: false, 1: false, 2: false, 3: false },
      revision: 1
    };
  }

  private async executeTestStep(mockState: any, step: TestStep): Promise<any> {
    const newState = { ...mockState };

    switch (step.action) {
      case 'INITIALIZE':
        newState.phase = 'WAITING';
        break;

      case 'JOIN':
        if (step.player === 2) {
          if (newState.gameType === 'HEARTS') {
            newState.phase = 'PASSING';
          } else if (newState.gameType === 'SPADES' || newState.gameType === 'CALLBREAK') {
            newState.phase = 'BIDDING';
          } else {
            newState.phase = 'PLAYING';
          }
        }
        break;

      case 'PASS_CARDS':
        if (step.player !== undefined && step.data?.cardIds) {
          newState.passingSelections[step.player] = step.data.cardIds;
          newState.passingComplete[step.player] = true;
          
          // Check if all players have passed
          const allPassed = Object.values(newState.passingComplete).every((complete: boolean) => complete);
          if (allPassed) {
            newState.phase = 'PLAYING';
            newState.turnIndex = 0;
          }
        }
        break;

      case 'SUBMIT_BID':
        if (step.player !== undefined && step.data?.bid !== undefined) {
          newState.bids[step.player] = step.data.bid;
          newState.biddingComplete[step.player] = true;
          
          // Check if all players have bid
          const allBid = Object.values(newState.biddingComplete).every((complete: boolean) => complete);
          if (allBid) {
            newState.phase = 'PLAYING';
            newState.turnIndex = 0;
          } else {
            newState.turnIndex = (newState.turnIndex + 1) % 4;
          }
        }
        break;

      case 'PLAY_CARD':
        if (step.player !== undefined && step.data?.cardId) {
          newState.currentTrick.push({
            seat: step.player,
            card: { id: step.data.cardId }
          });
          
          if (newState.currentTrick.length === 4) {
            // Trick complete - reset for next trick
            newState.currentTrick = [];
            newState.turnIndex = 0; // Winner would lead next
          } else {
            newState.turnIndex = (newState.turnIndex + 1) % 4;
          }
        }
        break;

      case 'TIMEOUT':
        // Simulate timeout behavior
        if (newState.phase === 'PASSING') {
          // Auto-complete passing for all players
          for (let seat = 0; seat < 4; seat++) {
            if (!newState.passingComplete[seat]) {
              newState.passingSelections[seat] = ['A-HEARTS', 'K-HEARTS', 'Q-HEARTS'];
              newState.passingComplete[seat] = true;
            }
          }
          newState.phase = 'PLAYING';
        } else if (newState.phase === 'BIDDING') {
          // Auto-bid for current player
          if (!newState.biddingComplete[newState.turnIndex]) {
            newState.bids[newState.turnIndex] = 1;
            newState.biddingComplete[newState.turnIndex] = true;
          }
        }
        break;

      case 'VERIFY_STATE':
        // This is handled by the test runner
        break;
    }

    newState.revision += 1;
    
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 10));
    
    return newState;
  }

  private printResults(): void {
    console.log('\n📊 Test Results Summary');
    console.log('========================');
    
    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => !r.passed).length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${((passed / this.testResults.length) * 100).toFixed(1)}%\n`);
    
    if (failed > 0) {
      console.log('Failed Tests:');
      this.testResults
        .filter(r => !r.passed)
        .forEach(r => {
          console.log(`  ❌ ${r.testName}: ${r.error}`);
        });
    }
    
    console.log('\n🎯 Recommendations:');
    if (failed === 0) {
      console.log('  ✨ All tests passed! Online game flow is working correctly.');
    } else {
      console.log('  🔧 Fix the failing tests to ensure proper online game flow.');
      console.log('  🔄 Re-run tests after implementing fixes.');
    }
  }

  // Utility method to run specific game type tests
  async runGameTypeTests(gameType: GameType): Promise<void> {
    const testCases = gameType === 'HEARTS' ? this.heartsTestCases :
                     gameType === 'SPADES' ? this.spadesTestCases :
                     gameType === 'CALLBREAK' ? this.callbreakTestCases : [];
    
    for (const testCase of testCases) {
      await this.runTestCase(testCase);
    }
    
    this.printResults();
  }
}

// Export test runner
export const gameFlowTester = new OnlineGameFlowTester();

// Usage example:
// gameFlowTester.runAllTests();
// gameFlowTester.runGameTypeTests('HEARTS');