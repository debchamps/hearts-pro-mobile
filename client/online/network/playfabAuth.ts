interface PlayFabLoginResponse {
  data?: {
    SessionTicket: string;
    PlayFabId: string;
    EntityToken?: {
      EntityToken: string;
      Entity?: { Id: string; Type: string };
    };
  };
  errorMessage?: string;
}

export interface PlayFabSession {
  titleId: string;
  sessionTicket: string;
  playFabId: string;
  entityToken?: string;
  entityId?: string;
  entityType?: string;
}

export type PlayFabAuthProvider = 'CUSTOM' | 'GOOGLE' | 'APPLE' | 'FACEBOOK';

const STORAGE_KEY = 'PLAYFAB_SESSION_CACHE_V1';
const SESSION_MAX_AGE_MS = 20 * 60 * 60 * 1000; // 20 hours (PlayFab tickets expire at 24h)

interface StoredSession extends PlayFabSession {
  cachedAt?: number;
}

function randomDeviceId() {
  return `device_${Math.random().toString(36).slice(2, 14)}`;
}

function getDeviceId() {
  const existing = localStorage.getItem('PLAYFAB_DEVICE_ID');
  if (existing) return existing;
  const created = randomDeviceId();
  localStorage.setItem('PLAYFAB_DEVICE_ID', created);
  return created;
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isSessionExpired(session: StoredSession): boolean {
  if (!session.cachedAt) return true; // legacy cache without timestamp — treat as expired
  return Date.now() - session.cachedAt > SESSION_MAX_AGE_MS;
}

async function runLogin(titleId: string, endpoint: string, payload: Record<string, unknown>): Promise<PlayFabSession> {
  const cached = readSession();
  if (cached && cached.titleId === titleId && cached.sessionTicket && !isSessionExpired(cached)) {
    return cached;
  }

  // Clear stale session before attempting fresh login
  clearSession();

  const response = await fetch(`https://${titleId}.playfabapi.com/Client/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PlayFabSDK': 'CardAdda-Android-Online',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PlayFab login failed: HTTP ${response.status} ${text}`);
  }

  const responseBody = (await response.json()) as PlayFabLoginResponse;
  if (!responseBody.data?.SessionTicket || !responseBody.data.PlayFabId) {
    throw new Error(responseBody.errorMessage || 'PlayFab login failed: missing session ticket');
  }

  const session: StoredSession = {
    titleId,
    sessionTicket: responseBody.data.SessionTicket,
    playFabId: responseBody.data.PlayFabId,
    entityToken: responseBody.data.EntityToken?.EntityToken,
    entityId: responseBody.data.EntityToken?.Entity?.Id,
    entityType: responseBody.data.EntityToken?.Entity?.Type,
    cachedAt: Date.now(),
  };

  writeSession(session);
  return session;
}

export async function loginPlayFabWithCustomId(titleId: string, customId?: string): Promise<PlayFabSession> {
  return runLogin(titleId, 'LoginWithCustomID', {
    TitleId: titleId,
    CustomId: customId || getDeviceId(),
    CreateAccount: true,
    InfoRequestParameters: {
      GetUserAccountInfo: true,
    },
  });
}

export async function loginPlayFabWithProvider(
  titleId: string,
  provider: PlayFabAuthProvider,
  token?: string,
  customIdFallback?: string
): Promise<PlayFabSession> {
  if (!token || provider === 'CUSTOM') {
    return loginPlayFabWithCustomId(titleId, customIdFallback);
  }

  if (provider === 'GOOGLE') {
    return runLogin(titleId, 'LoginWithGoogleAccount', {
      TitleId: titleId,
      AccessToken: token,
      CreateAccount: true,
    });
  }

  if (provider === 'APPLE') {
    return runLogin(titleId, 'LoginWithApple', {
      TitleId: titleId,
      IdentityToken: token,
      CreateAccount: true,
    });
  }

  return runLogin(titleId, 'LoginWithFacebook', {
    TitleId: titleId,
    AccessToken: token,
    CreateAccount: true,
  });
}
