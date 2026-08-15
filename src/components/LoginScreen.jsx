import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { API_BASE, GOOGLE_CLIENT_ID, isDesktop } from '../lib/api';
import { signInWithGoogleDesktop } from '../lib/desktopAuth';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Sign-in gate for the web app.
 *
 * Google Identity Services hands us an ID token in the browser; we send it
 * straight to the backend, which verifies the signature against Google's keys
 * and checks the account belongs to involve.no. Nothing the browser asserts
 * about the user is trusted — the token is the only thing that counts.
 */
const LoginScreen = ({ onSignedIn }) => {
  // Lazy initial value rather than setting state inside the effect: the script
  // may already be loaded if this screen is shown twice in one session.
  const [scriptReady, setScriptReady] = useState(
    () => Boolean(window.google?.accounts?.id)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const buttonRef = useRef(null);

  // Desktop signs in through the system browser, so Google's script is never
  // needed there.
  const desktop = isDesktop();

  const handleDesktopSignIn = async () => {
    setBusy(true);
    setError('');
    try {
      onSignedIn(await signInWithGoogleDesktop());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // Load Google's script once.
  useEffect(() => {
    if (desktop || window.google?.accounts?.id) return;

    const existing = document.getElementById('gsi-client');
    if (existing) {
      existing.addEventListener('load', () => setScriptReady(true));
      return;
    }

    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.id = 'gsi-client';
    script.async = true;
    script.defer = true;
    script.onload = () => setScriptReady(true);
    script.onerror = () =>
      setError('Kunne ikke laste Google-innlogging. Sjekk nettverket og prøv igjen.');
    document.head.appendChild(script);
  }, [desktop]);

  // Exchange Google's token for one of ours.
  useEffect(() => {
    if (desktop || !scriptReady || !buttonRef.current || !window.google?.accounts?.id) return;

    const handleCredential = async ({ credential }) => {
      setBusy(true);
      setError('');

      try {
        const res = await fetch(`${API_BASE}/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential }),
        });

        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(body.error || 'Innlogging feilet.');
        }

        onSignedIn(body);
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
    };

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.renderButton(buttonRef.current, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: 280,
    });
  }, [desktop, scriptReady, onSignedIn]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-ink text-sand">
      <div className="w-full max-w-sm surface rounded-2xl p-8 flex flex-col items-center text-center">
        <span
          aria-hidden="true"
          className="w-10 h-10 rounded-md bg-brand text-ink-deep flex items-center justify-center text-2xl font-bold leading-none mb-5"
        >
          I
        </span>

        <h1 className="text-xl font-bold tracking-wide mb-2">drop.involve.no</h1>
        <p className="text-sm text-sand/60 mb-8">
          Logg inn med Involve-kontoen din for å sende filer.
        </p>

        <div className="min-h-[44px] w-full flex flex-col items-center justify-center">
          {busy ? (
            <span className="flex items-center gap-2 text-sm text-sand/70">
              <Loader2 size={16} className="animate-spin" />
              {desktop ? 'Venter på nettleseren…' : 'Logger inn…'}
            </span>
          ) : desktop ? (
            <button
              onClick={handleDesktopSignIn}
              className="w-full max-w-[280px] px-6 py-3 rounded-lg bg-brand text-ink-deep font-medium hover:bg-brand/90 transition-colors"
            >
              Logg inn med Google
            </button>
          ) : (
            <>
              <div ref={buttonRef} />
              {!scriptReady && !error && (
                <span className="text-sm text-sand/50">Laster…</span>
              )}
            </>
          )}
        </div>

        {desktop && busy && (
          <p className="mt-4 text-xs text-sand/50">
            Fullfør innloggingen i nettleseren som åpnet seg.
          </p>
        )}

        {error && (
          <p className="mt-5 flex items-start gap-2 text-sm text-rose-400 text-left">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            {error}
          </p>
        )}
      </div>

      <p className="mt-6 text-xs text-sand/40 text-center max-w-sm">
        Kun kontoer på involve.no har tilgang. Mottakere trenger ikke å logge inn
        for å laste ned filer.
      </p>
    </div>
  );
};

export default LoginScreen;
