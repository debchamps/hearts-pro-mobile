const COIN_KEY = 'ONLINE_COIN_BALANCE';
const DEFAULT_COINS = 1000;
const COIN_EVENT = 'online-coins-updated';

export function getOnlineCoins(): number {
  try {
    const raw = localStorage.getItem(COIN_KEY);
    if (!raw) return DEFAULT_COINS;
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_COINS;
  } catch {
    return DEFAULT_COINS;
  }
}

export function setOnlineCoins(value: number): number {
  const next = Math.max(0, Math.floor(value));
  try {
    localStorage.setItem(COIN_KEY, String(next));
    window.dispatchEvent(new CustomEvent(COIN_EVENT, { detail: { coins: next } }));
  } catch {
    // ignore
  }
  return next;
}

export function applyOnlineCoinDelta(delta: number): number {
  return setOnlineCoins(getOnlineCoins() + delta);
}

export const ONLINE_COIN_EVENT = COIN_EVENT;
