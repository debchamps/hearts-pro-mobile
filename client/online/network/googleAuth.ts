import { Capacitor, registerPlugin } from '@capacitor/core';

interface GoogleUser {
  idToken?: string;
  serverAuthCode?: string;
  authentication?: {
    idToken?: string;
    accessToken?: string;
    serverAuthCode?: string;
  };
}

interface GoogleAuthPlugin {
  initialize(options: { clientId: string; scopes?: string[]; grantOfflineAccess?: boolean }): Promise<void>;
  signIn(): Promise<GoogleUser>;
}

const GoogleAuth = registerPlugin<GoogleAuthPlugin>('GoogleAuth');

function tokenFromGlobals(): string | undefined {
  const w = window as Window & {
    __PLAYFAB_GOOGLE_ID_TOKEN__?: string;
  };
  return w.__PLAYFAB_GOOGLE_ID_TOKEN__ || undefined;
}

function tokenFromStorage(): string | undefined {
  try {
    const value = localStorage.getItem('PLAYFAB_GOOGLE_ID_TOKEN');
    return value || undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token?: string) {
  if (!token) return;
  try {
    localStorage.setItem('PLAYFAB_GOOGLE_ID_TOKEN', token);
  } catch {
    // ignore storage failures
  }
}

export async function getGoogleIdToken(): Promise<string | undefined> {
  const envToken = (import.meta as any).env?.VITE_GOOGLE_ID_TOKEN;
  if (envToken) return envToken;

  const globalToken = tokenFromGlobals();
  if (globalToken) return globalToken;

  const cachedToken = tokenFromStorage();
  if (cachedToken) return cachedToken;

  if (!Capacitor.isNativePlatform()) {
    return undefined;
  }

  const clientId = (import.meta as any).env?.VITE_GOOGLE_WEB_CLIENT_ID;
  if (!clientId) {
    return undefined;
  }

  try {
    await GoogleAuth.initialize({
      clientId,
      scopes: ['profile', 'email'],
      grantOfflineAccess: true,
    });
    const user = await GoogleAuth.signIn();
    const token =
      user.authentication?.idToken ||
      user.idToken ||
      user.authentication?.serverAuthCode ||
      user.serverAuthCode;
    saveToken(token);
    return token;
  } catch {
    return undefined;
  }
}
