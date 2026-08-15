import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { API_BASE, GOOGLE_DESKTOP_CLIENT_ID } from './api';

/**
 * Google sign-in for the desktop apps.
 *
 * Google refuses custom URI schemes for desktop clients, so the app listens on
 * a loopback port and lets the system browser redirect back to it. Signing in
 * happens in the real browser, which means existing Google sessions, password
 * managers and hardware keys all work — none of which is true inside an
 * embedded webview.
 *
 * The authorization code is exchanged by our backend, not here, so the client
 * secret never ships inside the binary.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

const base64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomToken = (byteLength = 48) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
};

// PKCE: the challenge travels in the URL, the verifier stays here. An attacker
// who intercepts the redirect can't use the code without the verifier.
const challengeFor = async (verifier) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  );
  return base64url(digest);
};

export async function signInWithGoogleDesktop() {
  const port = await invoke('oauth_start');
  const redirectUri = `http://127.0.0.1:${port}`;

  const codeVerifier = randomToken();
  const codeChallenge = await challengeFor(codeVerifier);
  const state = randomToken(24);

  const authUrl = `${AUTH_ENDPOINT}?${new URLSearchParams({
    client_id: GOOGLE_DESKTOP_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    // A hint only — the backend still verifies the hd claim itself.
    hd: 'involve.no',
    prompt: 'select_account',
  })}`;

  await open(authUrl);

  // Blocks until the browser redirects back, or times out after three minutes.
  const target = await invoke('oauth_wait');
  const params = new URLSearchParams(target.split('?')[1] || '');

  if (params.get('error')) {
    throw new Error('Innlogging ble avbrutt.');
  }

  // Guards against a redirect we didn't initiate.
  if (params.get('state') !== state) {
    throw new Error('Ugyldig svar fra Google. Prøv igjen.');
  }

  const code = params.get('code');
  if (!code) {
    throw new Error('Fikk ingen kode fra Google.');
  }

  const res = await fetch(`${API_BASE}/auth/google/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.error || 'Innlogging feilet.');
  }

  return body;
}
