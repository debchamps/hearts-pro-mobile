import { GameType } from '../../../types';
import { localOnlineApi } from '../core/serverEmulator';
import { OnlineApi } from '../types';
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

  private async call<T>(functionName: string, payload: unknown): Promise<T> {
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
      throw new Error(`PlayFab HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (data?.data?.Error) {
      const err = data.data.Error;
      const msg = err.Message || 'CloudScript execution failed';
      const stack = err.StackTrace ? `\nStack: ${String(err.StackTrace).slice(0, 700)}` : '';
      const logs = Array.isArray(data?.data?.Logs) && data.data.Logs.length > 0
        ? `\nLogs: ${data.data.Logs.slice(0, 3).map((l: any) => l.Message || JSON.stringify(l)).join(' | ')}`
        : '';
      throw new Error(`[PlayFab:${functionName}] ${msg}${stack}${logs}`);
    }

    return data?.data?.FunctionResult as T;
  }

  createLobby(input: { gameType: GameType; region?: string }) {
    return this.call('createLobby', input);
  }

  findMatch(input: {
    gameType: GameType;
    lobbyId?: string;
    playerName?: string;
    autoMoveOnTimeout?: boolean;
    currentMatchId?: string;
  }) {
    return this.call('findMatch', input);
  }

  createMatch(input: { gameType: GameType; playerName: string; autoMoveOnTimeout?: boolean }) {
    return this.call('createMatch', input);
  }

  joinMatch(input: { matchId: string; playerName: string }) {
    return this.call('joinMatch', input);
  }

  submitMove(input: { matchId: string; seat: number; cardId: string; expectedRevision: number }) {
    return this.call('submitMove', input);
  }

  submitPass(input: { matchId: string; seat: number; cardIds: string[]; expectedRevision: number }) {
    return this.call('submitPass', input);
  }

  submitBid(input: { matchId: string; seat: number; bid: number; expectedRevision: number }) {
    return this.call('submitBid', input);
  }

  getSnapshot(input: { matchId: string; seat?: number }) {
    return this.call('getSnapshot', input);
  }

  subscribeToMatch(input: { matchId: string; sinceEventId?: number; sinceRevision?: number; seat?: number; subscriptionId?: string }) {
    return this.call('subscribeToMatch', input);
  }

  unsubscribeFromMatch(input: { matchId: string; subscriptionId: string }) {
    return this.call('unsubscribeFromMatch', input);
  }

  timeoutMove(input: { matchId: string }) {
    return this.call('timeoutMove', input);
  }

  endMatch(input: { matchId: string }) {
    return this.call('endMatch', input);
  }

  updateCoins(input: { playFabId: string; delta: number }) {
    return this.call('updateCoins', input);
  }

  reconnect(input: { matchId: string; playFabId: string }) {
    return this.call('reconnect', input);
  }
}

export function createOnlineApi(): OnlineApi {
  const titleId = (import.meta as any).env?.VITE_PLAYFAB_TITLE_ID || 'EF824';
  const sessionTicket = (import.meta as any).env?.VITE_PLAYFAB_SESSION_TICKET;

  if (!titleId || !sessionTicket) {
    return localOnlineApi;
  }

  return new PlayFabCloudScriptApi({
    titleId,
    sessionTicket,
  });
}

export async function createOnlineApiAsync(): Promise<OnlineApi> {
  const titleId = (import.meta as any).env?.VITE_PLAYFAB_TITLE_ID || 'EF824';
  const envProvider = ((import.meta as any).env?.VITE_PLAYFAB_AUTH_PROVIDER || 'GOOGLE') as PlayFabAuthProvider;
  const provider = (getDebugAuthMode() || envProvider) as PlayFabAuthProvider;
  const authToken = (import.meta as any).env?.VITE_PLAYFAB_AUTH_TOKEN;
  const customId = (import.meta as any).env?.VITE_PLAYFAB_CUSTOM_ID;

  if (!titleId) {
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
    return new PlayFabCloudScriptApi({
      titleId,
      sessionTicket: session.sessionTicket,
      refreshSession,
    });
  } catch {
    return localOnlineApi;
  }
}
