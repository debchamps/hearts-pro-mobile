export type DebugAuthMode = 'CUSTOM' | 'GOOGLE';

const AUTH_MODE_KEY = 'PLAYFAB_AUTH_MODE_OVERRIDE';

export function getDebugAuthMode(): DebugAuthMode | null {
  try {
    const value = localStorage.getItem(AUTH_MODE_KEY);
    if (value === 'CUSTOM' || value === 'GOOGLE') return value;
  } catch {
    // ignore
  }
  return null;
}

export function setDebugAuthMode(mode: DebugAuthMode): void {
  try {
    localStorage.setItem(AUTH_MODE_KEY, mode);
  } catch {
    // ignore
  }
}
