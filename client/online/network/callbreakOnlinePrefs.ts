const CALLBREAK_AUTO_MOVE_KEY = 'CALLBREAK_ONLINE_AUTO_MOVE_ON_TIMEOUT';

export function getCallbreakAutoMoveOnTimeout(): boolean {
  try {
    const raw = localStorage.getItem(CALLBREAK_AUTO_MOVE_KEY);
    if (raw === null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

export function setCallbreakAutoMoveOnTimeout(enabled: boolean) {
  try {
    localStorage.setItem(CALLBREAK_AUTO_MOVE_KEY, enabled ? '1' : '0');
  } catch {}
}
