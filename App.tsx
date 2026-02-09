
import React, { useState, useEffect } from 'react';
import { ScreenState, GameType, Player, GameState } from './types';
import { Home } from './Home';
import { HeartsGame } from './HeartsGame';
import { SpadesGame } from './SpadesGame';
import { CallbreakGame } from './CallbreakGame';
import { persistenceService } from './services/persistence';

const INITIAL_PLAYERS: Player[] = [
  { id: 0, name: 'YOU', avatar: '👤', hand: [], score: 0, currentRoundScore: 0, isHuman: true, teamId: 0, tricksWon: 0 },
  { id: 1, name: 'GARY', avatar: '🧔', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 1, tricksWon: 0 },
  { id: 2, name: 'ANNA', avatar: '👩', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 0, tricksWon: 0 },
  { id: 3, name: 'JACK', avatar: '👱', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 1, tricksWon: 0 },
];

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('HOME');
  const [gameType, setGameType] = useState<GameType>('HEARTS');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [resumedState, setResumedState] = useState<GameState | null>(null);
  const [hasSavedGame, setHasSavedGame] = useState(false);

  useEffect(() => {
    async function checkSaved() {
      const saved = await persistenceService.loadGame();
      if (saved) {
        setHasSavedGame(true);
      }
    }
    checkSaved();
  }, []);

  const handleSelectGame = (type: GameType) => {
    setResumedState(null);
    setGameType(type);
    setScreen('GAME');
    persistenceService.clearGame();
  };

  const handleResumeGame = async () => {
    const saved = await persistenceService.loadGame();
    if (saved) {
      setGameType(saved.gameType);
      setResumedState(saved.gameState);
      setScreen('GAME');
    }
  };

  const handleExitGame = () => {
    setScreen('HOME');
    setResumedState(null);
    persistenceService.loadGame().then(saved => setHasSavedGame(!!saved));
  };

  if (screen === 'HOME') {
    return (
      <Home 
        onSelectGame={handleSelectGame} 
        onResumeGame={hasSavedGame ? handleResumeGame : undefined} 
      />
    );
  }

  if (screen === 'GAME') {
    return (
      <div className="felt-bg h-screen w-full">
        {gameType === 'SPADES' ? (
          <SpadesGame 
            initialPlayers={INITIAL_PLAYERS} 
            initialState={resumedState}
            onExit={handleExitGame} 
            soundEnabled={soundEnabled} 
          />
        ) : gameType === 'CALLBREAK' ? (
          <CallbreakGame 
            initialPlayers={INITIAL_PLAYERS} 
            initialState={resumedState}
            onExit={handleExitGame} 
            soundEnabled={soundEnabled} 
          />
        ) : (
          <HeartsGame 
            initialPlayers={INITIAL_PLAYERS} 
            initialState={resumedState}
            onExit={handleExitGame} 
            soundEnabled={soundEnabled} 
          />
        )}
      </div>
    );
  }

  return null;
}
