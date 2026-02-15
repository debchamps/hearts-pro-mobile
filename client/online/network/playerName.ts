const PLAYER_NAME_KEY = 'ONLINE_PLAYER_NAME';

function platformLabel(): string {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|Mobile/i.test(ua)) return 'Mobile';
  return 'Web';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function getLocalPlayerName(): string {
  try {
    const explicit = localStorage.getItem('PLAYFAB_PLAYER_NAME');
    if (explicit && explicit.trim()) return explicit.trim().slice(0, 20);

    const saved = localStorage.getItem(PLAYER_NAME_KEY);
    if (saved && saved.trim()) return saved;

    const generated = `${platformLabel()}-${randomSuffix()}`;
    localStorage.setItem(PLAYER_NAME_KEY, generated);
    return generated;
  } catch {
    return `${platformLabel()}-${randomSuffix()}`;
  }
}
