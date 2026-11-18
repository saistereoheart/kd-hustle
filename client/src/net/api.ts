import type { PublicConfig } from '@kh/shared';

/** localStorage key for the session token. `?profile=2` gives a separate login per tab
 *  (handy for testing two accounts in one browser). */
export function tokenKey(): string {
  const profile = new URLSearchParams(location.search).get('profile');
  return profile && /^[\w-]{1,16}$/.test(profile) ? `kh_token_${profile}` : 'kh_token';
}

export function loadToken(): string | null {
  try {
    return localStorage.getItem(tokenKey());
  } catch {
    return null;
  }
}

export function saveToken(token: string) {
  try {
    localStorage.setItem(tokenKey(), token);
  } catch {
    /* private mode: session lasts until reload */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(tokenKey());
  } catch {
    /* ignore */
  }
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const res = await fetch('/api/config/public');
  if (!res.ok) throw new Error(`Config request failed (${res.status})`);
  return (await res.json()) as PublicConfig;
}

/** Checks a saved session token. 'offline' when the server can't be reached. */
export async function checkSession(token: string): Promise<{ ok: true; username: string } | { ok: false; offline?: boolean }> {
  try {
    const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    const data = (await res.json()) as { ok: boolean; username?: string };
    return data.ok && data.username ? { ok: true, username: data.username } : { ok: false };
  } catch {
    return { ok: false, offline: true };
  }
}

export type AuthResponse = { ok: true; token: string; username: string } | { ok: false; error: string };

export async function postAuth(path: '/api/login' | '/api/register', body: Record<string, string>): Promise<AuthResponse> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = (await res.json()) as AuthResponse;
    return data;
  } catch {
    return { ok: false, error: 'Cannot reach the server. Is it still running?' };
  }
}
