
import React, { useState } from 'react';
import { ScreenState, GameType, Player } from './types';
import { Home } from './Home';
import { HeartsGame } from './HeartsGame';
import { SpadesGame } from './SpadesGame';

const INITIAL_PLAYERS: Player[] = [
  { id: 0, name: 'YOU', avatar: '👤', hand: [], score: 0, currentRoundScore: 0, isHuman: true, teamId: 0, tricksWon: 0 },
  { id: 1, name: 'FISH', avatar: '🐟', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 1, tricksWon: 0 },
  { id: 2, name: 'SNAKE', avatar: '🐍', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 0, tricksWon: 0 },
  { id: 3, name: 'SHRIMP', avatar: '🦐', hand: [], score: 0, currentRoundScore: 0, isHuman: false, teamId: 1, tricksWon: 0 },
];

export default function App() {
  const [screen, setScreen] = useState<ScreenState>('HOME');
  const [gameType, setGameType] = useState<GameType>('HEARTS');
  const [soundEnabled, setSoundEnabled] = useState(true);

  const handleSelectGame = (type: GameType) => {
    setGameType(type);
    setScreen('GAME');
  };

  const handleExitGame = () => {
    setScreen('HOME');
  };

  if (screen === 'HOME') {
    return <Home onSelectGame={handleSelectGame} />;
  }

  if (screen === 'GAME') {
    if (gameType === 'SPADES') {
      return (
        <div className="felt-bg h-screen w-full">
          <SpadesGame 
            initialPlayers={INITIAL_PLAYERS} 
            onExit={handleExitGame} 
            soundEnabled={soundEnabled} 
          />
        </div>
      );
    }
    
    return (
      <div className="felt-bg h-screen w-full">
        <HeartsGame 
          initialPlayers={INITIAL_PLAYERS} 
          onExit={handleExitGame} 
          soundEnabled={soundEnabled} 
        />
      </div>
    );
  }

  return null;
}
