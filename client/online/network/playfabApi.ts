import { GameType } from '../../../types';
import { localOnlineApi } from '../core/serverEmulator';
import { GameStateDelta, MatchResult, MatchSubscriptionResult, OnlineApi, ReconnectPayload } from '../types';
import { clearSession, loginPlayFabWithProvider, PlayFabAuthProvider } from './playfabAuth';
import { getGoogleIdToken } from './googleAuth';
import { getDebugAuthMode } from './authMode';

interface PlayFabOptions {
  titleId: string;
  sessionTicket: string;
  cloudScriptFunctionPrefix?: string;
  refreshSession?: () => Promise<string>;
}

class PlayFabCloudScriptApi implements OnlineApi {
  private sessionTicket: string;

  constructor(private readonly options: PlayFabOptions) {
    this.sessionTicket = options.sessionTicket;
  }

  private async call<T>(functionName: string, payload: unknown, retries = 0): Promise<T> {
    const attempt = async (ticket: string): Promise<Response> => {
      const url = `https://${this.options.titleId}.playfabapi.com/Client/ExecuteCloudScript`;
      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Authorization': ticket,
        },
        body: JSON.stringify({
          FunctionName: functionName,
          FunctionParameter: payload,
          GeneratePlayStreamEvent: false,
        }),
      });
    };

    let response = await attempt(this.sessionTicket);

    // On 401, clear stale session and re-authenticate once
    if (response.status === 401 && this.options.refreshSession) {
      try {
        this.sessionTicket = await this.options.refreshSession();
        response = await attempt(this.sessionTicket);
      } catch {
        // Re-auth failed — throw the original 401
      }
    }

    if (!response.ok) {
      const text = await response.text();
      // Retry on 5xx server errors
      if (response.status >= 500 && retries < 2) {
        await new Promise((r) => setTimeout(r, 300 * (retries + 1)));
        return this.call<T>(functionName, payload, retries + 1);
      }
      throw new Error(`PlayFab HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (data?.data?.Error) {
      const err = data.data.Error;
      const errType = err.Error || '';
      const msg = err.Message || 'CloudScript execution failed';
      const stack = err.StackTrace ? `\nStack: ${String(err.StackTrace).slice(0, 700)}` : '';
      const logs = Array.isArray(data?.data?.Logs) && data.data.Logs.length > 0
        ? `\nLogs: ${data.data.Logs.slice(0, 3).map((l: any) => l.Message || JSON.stringify(l)).join(' | ')}`
        : '';
      const fullMsg = `[PlayFab:${functionName}] ${errType} ${msg}${stack}${logs}`;

      // Retry "Match not found" errors once — can be caused by TitleData replication lag
      if (msg.includes('Match not found') && retries < 2) {
        await new Promise((r) => setTimeout(r, 500 * (retries + 1)));
        return this.call<T>(functionName, payload, retries + 1);
      }

      throw new Error(fullMsg);
    }

    return data?.data?.FunctionResult as T;
  }

  createLobby(input: { gameType: GameType; region?: string }) {
    return this.call<{ lobbyId: string }>('createLobby', input);
  }

  findMatch(input: {
    gameType: GameType;
    lobbyId?: string;
    playerName?: string;
    autoMoveOnTimeout?: boolean;
    currentMatchId?: string;
  }) {
    return this.call<{ matchId: string; seat: number; snapshot?: GameStateDelta }>('findMatch', input);
  }

  createMatch(input: { gameType: GameType; playerName: string; autoMoveOnTimeout?: boolean }) {
    return this.call<{ matchId: string; seat: number; snapshot?: GameStateDelta }>('createMatch', input);
  }

  joinMatch(input: { matchId: string; playerName: string }) {
    return this.call<{ seat: number }>('joinMatch', input);
  }

  submitMove(input: { matchId: string; seat: number; cardId: string; expectedRevision: number }) {
    return this.call<GameStateDelta>('submitMove', input);
  }

  submitPass(input: { matchId: string; seat: number; cardIds: string[]; expectedRevision: number }) {
    return this.call<GameStateDelta>('submitPass', input);
  }

  submitBid(input: { matchId: string; seat: number; bid: number; expectedRevision: number }) {
    return this.call<GameStateDelta>('submitBid', input);
  }

  getSnapshot(input: { matchId: string; seat?: number }) {
    return this.call<GameStateDelta>('getSnapshot', input);
  }

  subscribeToMatch(input: { matchId: string; sinceEventId?: number; sinceRevision?: number; seat?: number; subscriptionId?: string }) {
    return this.call<MatchSubscriptionResult>('subscribeToMatch', input);
  }

  unsubscribeFromMatch(input: { matchId: string; subscriptionId: string }) {
    return this.call<{ ok: boolean }>('unsubscribeFromMatch', input);
  }

  timeoutMove(input: { matchId: string }) {
    return this.call<GameStateDelta>('timeoutMove', input);
  }

  endMatch(input: { matchId: string }) {
    return this.call<MatchResult>('endMatch', input);
  }

  updateCoins(input: { playFabId: string; delta: number }) {
    return this.call<{ coins: number }>('updateCoins', input);
  }

  reconnect(input: { matchId: string; playFabId: string }) {
    return this.call<{ seat: number; delta: GameStateDelta }>('reconnect', input);
  }
}

export function createOnlineApi(): OnlineApi {
  const titleId = (import.meta as any).env?.VITE_PLAYFAB_TITLE_ID || 'EF824';
  const sessionTicket = (import.meta as any).env?.VITE_PLAYFAB_SESSION_TICKET;

  if (!titleId || !sessionTicket) {
    console.warn('[OnlineApi:sync] No session ticket, using async path instead. This sync fallback returns local emulator.');
    return localOnlineApi;
  }

  return new PlayFabCloudScriptApi({
    titleId,
    sessionTicket,
  });
}

export async function createOnlineApiAsync(): Promise<OnlineApi> {
  const titleId = (import.meta as any).env?.VITE_PLAYFAB_TITLE_ID || 'EF824';
  const envProvider = ((import.meta as any).env?.VITE_PLAYFAB_AUTH_PROVIDER || 'CUSTOM') as PlayFabAuthProvider;
  const provider = (getDebugAuthMode() || envProvider) as PlayFabAuthProvider;
  const authToken = (import.meta as any).env?.VITE_PLAYFAB_AUTH_TOKEN;
  const customId = (import.meta as any).env?.VITE_PLAYFAB_CUSTOM_ID;

  if (!titleId) {
    console.warn('[OnlineApi] No VITE_PLAYFAB_TITLE_ID set, falling back to local emulator');
    return localOnlineApi;
  }

  const refreshSession = async (): Promise<string> => {
    clearSession();
    const freshToken = provider === 'GOOGLE' && !authToken ? await getGoogleIdToken() : authToken;
    const freshSession = await loginPlayFabWithProvider(titleId, provider, freshToken, customId);
    return freshSession.sessionTicket;
  };

  try {
    const resolvedToken = provider === 'GOOGLE' && !authToken ? await getGoogleIdToken() : authToken;
    const session = await loginPlayFabWithProvider(titleId, provider, resolvedToken, customId);
    console.log('[OnlineApi] Connected to PlayFab server, titleId:', titleId, 'playFabId:', session.playFabId);
    return new PlayFabCloudScriptApi({
      titleId,
      sessionTicket: session.sessionTicket,
      refreshSession,
    });
  } catch (e) {
    console.error('[OnlineApi] PlayFab login failed, falling back to local emulator:', e);
    return localOnlineApi;
  }
}
