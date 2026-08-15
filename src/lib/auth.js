import { readJson, writeJson, STORAGE_KEYS } from './storage';

/**
 * The signed-in session: the token the backend issued, who it belongs to, and
 * when it stops being valid.
 *
 * Stored in localStorage so a 30-day session survives closing the browser. The
 * expiry recorded here is only for deciding when to show the sign-in screen —
 * the backend independently verifies the token's own expiry on every request,
 * so editing this value gains an attacker nothing.
 */

export function loadSession() {
  const session = readJson(STORAGE_KEYS.session, null);

  if (!session || !session.token || !session.expiresAt) return null;
  if (session.expiresAt < Date.now()) {
    clearSession();
    return null;
  }

  return session;
}

export function saveSession({ token, expiresIn, user }) {
  const session = {
    token,
    user,
    expiresAt: Date.now() + (Number(expiresIn) || 0) * 1000,
  };
  writeJson(STORAGE_KEYS.session, session);
  return session;
}

export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEYS.session);
  } catch {
    // Storage unavailable; the in-memory state is cleared by the caller anyway.
  }
}
