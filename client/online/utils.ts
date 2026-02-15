import { Card } from '../../types';

export function seededRandom(seed: number): () => number {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rnd = seededRandom(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function lowestCard(cards: Card[]): Card {
  return cards.reduce((best, curr) => {
    if (curr.value < best.value) return curr;
    if (curr.value === best.value && curr.suit < best.suit) return curr;
    return best;
  });
}

export function highestCard(cards: Card[]): Card {
  return cards.reduce((best, curr) => {
    if (curr.value > best.value) return curr;
    if (curr.value === best.value && curr.suit > best.suit) return curr;
    return best;
  });
}
