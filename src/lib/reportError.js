import { API_BASE } from './api';

/**
 * Sends crashes to our own backend, where they land in the server log.
 *
 * Without this, a crash is only ever seen by the person it happened to — which
 * is how the app once spent weeks white-screening on startup without anyone
 * knowing why.
 *
 * Deliberately not Sentry: no third party holding user data, no account to
 * maintain, and errors show up in `pm2 logs` alongside everything else.
 */

// Repeated crashes usually come from one cause, and a render loop could
// otherwise report hundreds of times.
const alreadySent = new Set();

export function reportError(error, context = 'unknown') {
  try {
    const message = String(error?.message || error || 'Unknown error');
    const key = `${context}:${message}`;

    if (alreadySent.has(key)) return;
    alreadySent.add(key);

    const body = JSON.stringify({
      message,
      stack: String(error?.stack || ''),
      context,
      appVersion: window.__APP_VERSION__ || '',
      userAgent: navigator.userAgent,
    });

    // keepalive so the report still goes out if the crash takes the page with
    // it. Failures are swallowed — an error while reporting an error helps
    // nobody.
    fetch(`${API_BASE}/client-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never be the thing that breaks.
  }
}

/** Catches what React's error boundary can't: async and non-React failures. */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    reportError(event.error || event.message, 'window.onerror');
  });

  window.addEventListener('unhandledrejection', (event) => {
    // Aborted uploads reject by design and aren't worth reporting.
    if (event.reason?.aborted) return;
    reportError(event.reason, 'unhandledrejection');
  });
}
