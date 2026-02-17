import React, { useState } from 'react';
import { GameType } from '../types';
import { GameFlowSimulator } from '../tools/GameFlowSimulator';
import { gameFlowTester } from '../tests/OnlineGameFlowTests';

interface OnlineGameFlowToolsProps {
  onClose: () => void;
}

export function OnlineGameFlowTools({ onClose }: OnlineGameFlowToolsProps) {
  const [activeTab, setActiveTab] = useState<'simulator' | 'tests' | 'guide'>('simulator');
  const [selectedGameType, setSelectedGameType] = useState<GameType>('HEARTS');
  const [showSimulator, setShowSimulator] = useState(false);
  const [testResults, setTestResults] = useState<string>('');
  const [isRunningTests, setIsRunningTests] = useState(false);

  const runTests = async (gameType?: GameType) => {
    setIsRunningTests(true);
    setTestResults('Running tests...\n');
    
    try {
      // Capture console output
      const originalLog = console.log;
      let output = '';
      console.log = (...args) => {
        output += args.join(' ') + '\n';
        originalLog(...args);
      };

      if (gameType) {
        await gameFlowTester.runGameTypeTests(gameType);
      } else {
        await gameFlowTester.runAllTests();
      }

      console.log = originalLog;
      setTestResults(output);
    } catch (error) {
      setTestResults(`Error running tests: ${error}`);
    } finally {
      setIsRunningTests(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[1000]">
      <div className="bg-gray-900 rounded-2xl p-6 max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-black text-white">
            Online Game Flow Tools
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white font-black"
          >
            ×
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`px-4 py-2 rounded-lg font-bold ${
              activeTab === 'simulator' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            Game Simulator
          </button>
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-4 py-2 rounded-lg font-bold ${
              activeTab === 'tests' ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            Flow Tests
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-4 py-2 rounded-lg font-bold ${
              activeTab === 'guide' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            Integration Guide
          </button>
        </div>

        {/* Game Type Selector */}
        <div className="flex gap-2 mb-4">
          <label className="text-white font-bold">Game Type:</label>
          <select
            value={selectedGameType}
            onChange={(e) => setSelectedGameType(e.target.value as GameType)}
            className="px-3 py-1 bg-gray-700 text-white rounded"
          >
            <option value="HEARTS">Hearts</option>
            <option value="SPADES">Spades</option>
            <option value="CALLBREAK">Callbreak</option>
          </select>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'simulator' && (
            <div className="h-full flex flex-col">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-white mb-2">Game Flow Simulator</h3>
                <p className="text-gray-300 text-sm mb-4">
                  Simulate online game flows to test and validate behavior against offline games.
                </p>
                <button
                  onClick={() => setShowSimulator(true)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold"
                >
                  Launch {selectedGameType} Simulator
                </button>
              </div>
              
              <div className="bg-gray-800 rounded-lg p-4 flex-1 overflow-y-auto">
                <h4 className="text-white font-bold mb-2">Simulator Features:</h4>
                <ul className="text-gray-300 text-sm space-y-1">
                  <li>• Step-by-step game flow visualization</li>
                  <li>• Phase transition testing</li>
                  <li>• Player action simulation</li>
                  <li>• State synchronization validation</li>
                  <li>• Timeout handling verification</li>
                  <li>• Comparison with offline game behavior</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'tests' && (
            <div className="h-full flex flex-col">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-white mb-2">Automated Flow Tests</h3>
                <p className="text-gray-300 text-sm mb-4">
                  Run comprehensive tests to validate online game flow implementation.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => runTests()}
                    disabled={isRunningTests}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg font-bold disabled:opacity-50"
                  >
                    {isRunningTests ? 'Running...' : 'Run All Tests'}
                  </button>
                  <button
                    onClick={() => runTests(selectedGameType)}
                    disabled={isRunningTests}
                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg font-bold disabled:opacity-50"
                  >
                    {isRunningTests ? 'Running...' : `Test ${selectedGameType}`}
                  </button>
                </div>
              </div>
              
              <div className="bg-gray-800 rounded-lg p-4 flex-1 overflow-y-auto">
                <h4 className="text-white font-bold mb-2">Test Results:</h4>
                <pre className="text-gray-300 text-xs whitespace-pre-wrap">
                  {testResults || 'No tests run yet. Click a button above to start testing.'}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'guide' && (
            <div className="h-full flex flex-col">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-white mb-2">Integration Guide</h3>
                <p className="text-gray-300 text-sm mb-4">
                  Step-by-step guide to implement the online game flow fixes.
                </p>
              </div>
              
              <div className="bg-gray-800 rounded-lg p-4 flex-1 overflow-y-auto">
                <div className="text-gray-300 text-sm space-y-4">
                  <div>
                    <h4 className="text-white font-bold mb-2">🎯 Issues Fixed</h4>
                    <ul className="space-y-1">
                      <li>• Hearts: Missing passing phase implementation</li>
                      <li>• Spades/Callbreak: Missing bidding phase implementation</li>
                      <li>• General: Poor state synchronization across players</li>
                      <li>• General: Incomplete timeout handling</li>
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="text-white font-bold mb-2">🚀 Implementation Steps</h4>
                    <ol className="space-y-1 list-decimal list-inside">
                      <li>Update server-side PlayFab handlers</li>
                      <li>Replace OnlineGameScreen with enhanced version</li>
                      <li>Update game types and interfaces</li>
                      <li>Enhance MultiplayerService</li>
                      <li>Run tests and validate functionality</li>
                    </ol>
                  </div>
                  
                  <div>
                    <h4 className="text-white font-bold mb-2">📁 Files to Update</h4>
                    <ul className="space-y-1">
                      <li>• <code>server/playfab/cloudscript/handlers.js</code></li>
                      <li>• <code>client/OnlineGameScreen.tsx</code></li>
                      <li>• <code>client/online/network/multiplayerService.ts</code></li>
                      <li>• <code>types.ts</code></li>
                    </ul>
                  </div>
                  
                  <div>
                    <h4 className="text-white font-bold mb-2">🧪 Testing</h4>
                    <p>Use the simulator and automated tests to validate:</p>
                    <ul className="space-y-1 mt-2">
                      <li>• Phase transitions work correctly</li>
                      <li>• All players receive state updates</li>
                      <li>• Timeout handling functions properly</li>
                      <li>• Game flow matches offline behavior</li>
                    </ul>
                  </div>
                  
                  <div className="bg-yellow-900/20 border border-yellow-600/30 rounded p-3">
                    <h4 className="text-yellow-400 font-bold mb-1">⚠️ Important</h4>
                    <p className="text-yellow-200 text-xs">
                      Test thoroughly in a development environment before deploying to production.
                      The enhanced handlers include breaking changes that require careful migration.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Game Flow Simulator Modal */}
      {showSimulator && (
        <GameFlowSimulator
          gameType={selectedGameType}
          onClose={() => setShowSimulator(false)}
        />
      )}
    </div>
  );
}