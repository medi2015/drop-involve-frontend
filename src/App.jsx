import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Globe, History, LayoutGrid } from 'lucide-react';
import UploadCard from './components/UploadCard';
import ContentAdmin from './components/ContentAdmin';
import LoginScreen from './components/LoginScreen';
import { loadSession, saveSession, clearSession } from './lib/auth';
import { API_BASE } from './lib/api';
import { getVersion } from '@tauri-apps/api/app';
import { enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';

// --- MAIN APP COMPONENT ---
const App = () => {
  // Restored synchronously so a signed-in user never sees the login screen
  // flash on load.
  const [session, setSession] = useState(() => loadSession());
  const [showHistory, setShowHistory] = useState(false);
  // The landing-page editor. Behind the same Google sign-in as everything
  // else, so there's no second login to manage.
  const [showContent, setShowContent] = useState(false);
  // Only meaningful in the desktop app — the website is always whatever was
  // last deployed, so a version number there would just be noise.
  const [appVersion, setAppVersion] = useState('');

  /**
   * Back to the send screen.
   *
   * History and the content editor used to be independent flags, so opening one
   * on top of the other left both set — closing the editor dropped you into
   * history rather than the send screen, with no way out but closing that too.
   * Everything that changes view now goes through one of these.
   */
  const showSend = () => {
    setShowHistory(false);
    setShowContent(false);
  };

  const openHistory = () => {
    setShowContent(false);
    setShowHistory((open) => !open);
  };

  const openContent = () => {
    setShowHistory(false);
    setShowContent((open) => !open);
  };

  const handleSignedIn = (payload) => setSession(saveSession(payload));

  const handleSignOut = () => {
    clearSession();
    setSession(null);
  };

  // Ends every session for this account, not just this device — for a lost
  // laptop, or a machine you signed in on and won't be back to.
  const handleSignOutEverywhere = async () => {
    if (!window.confirm('Logge ut av alle enheter? Du må logge inn på nytt overalt.')) return;

    try {
      await fetch(`${API_BASE}/auth/revoke-sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch {
      // Sign out locally regardless — leaving them signed in here would be
      // the wrong failure mode.
    }

    clearSession();
    setSession(null);
  };

  useEffect(() => {
    getVersion()
      .then((version) => {
        setAppVersion(version);
        // Picked up by error reports, so a crash tells us which build it came
        // from rather than leaving us guessing.
        window.__APP_VERSION__ = version;
      })
      .catch(() => {
        // Running in a browser rather than the desktop app.
      });
  }, []);

  // Start with the OS. This used to live in the tray component, which no
  // longer exists — without it here, autostart silently stops being enabled.
  useEffect(() => {
    const ensureAutostart = async () => {
      try {
        if (!(await isEnabled())) await enable();
      } catch {
        // Not running in Tauri, or the plugin is unavailable on this platform.
      }
    };
    ensureAutostart();
  }, []);

  // 1. UPDATER LOGIC
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const update = await check();
        if (update) {
          const yes = await ask(
            `En ny versjon (${update.version}) er tilgjengelig. Vil du installere den nå?`,
            {
              title: 'Oppdatering tilgjengelig',
              kind: 'info',
              okLabel: 'Ja, oppdater',
              cancelLabel: 'Senere'
            }
          );

          if (yes) {
            await update.downloadAndInstall();
            await relaunch();
          }
        }
      } catch (error) {
        console.error("Update check failed:", error);
      }
    };

    setTimeout(checkForUpdates, 3000);
  }, []);


  // Both web and desktop are gated now. They reach Google differently — the
  // browser via Identity Services, the desktop app via a loopback redirect —
  // but both end up with a session issued by our own backend.
  if (!session) {
    return <LoginScreen onSignedIn={handleSignedIn} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-5 md:px-10 md:py-8 bg-ink text-sand">
      <main className="w-full max-w-3xl flex-1 flex flex-col">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full flex items-center gap-3 mb-5"
        >
          <button
            onClick={showSend}
            title="Til forsiden"
            aria-label="Til forsiden"
            className="flex items-center gap-3 group shrink-0"
          >
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-md bg-brand text-ink-deep flex items-center justify-center text-lg font-bold leading-none shrink-0"
            >
              I
            </span>
            <h1 className="text-base font-bold tracking-wide text-sand leading-none group-hover:text-brand transition-colors">
              drop.involve.no
            </h1>
          </button>

          <div className="ml-auto flex items-center gap-4 text-sm min-w-0">
            <button
              onClick={openHistory}
              className={`flex items-center gap-2 transition-colors shrink-0 ${
                showHistory ? 'text-brand' : 'text-sand/60 hover:text-brand'
              }`}
            >
              <History size={15} /> Historikk
            </button>

            {/* Same weight as Historikk rather than a tab: only a couple of
                people edit the landing page, and the rest shouldn't have to
                wonder what it is. Hidden below md for the same reason "Alle
                enheter" is — nobody crops a background image on a phone. */}
            <button
              onClick={openContent}
              className={`hidden md:flex items-center gap-2 transition-colors shrink-0 ${
                showContent ? 'text-brand' : 'text-sand/60 hover:text-brand'
              }`}
            >
              <LayoutGrid size={15} /> Innhold
            </button>

            {session?.user && (
              <>
                <span className="text-sand/70 truncate hidden sm:inline">
                  {session.user.name || session.user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="text-sand/50 hover:text-brand transition-colors shrink-0"
                >
                  Logg ut
                </button>
                <button
                  onClick={handleSignOutEverywhere}
                  title="Avslutter økten på alle enheter"
                  className="text-sand/35 hover:text-brand transition-colors shrink-0 hidden md:inline"
                >
                  Alle enheter
                </button>
              </>
            )}
          </div>
        </motion.header>

        {showContent ? (
          <ContentAdmin session={session} onClose={showSend} />
        ) : (
          <UploadCard
            session={session}
            showHistory={showHistory}
            setShowHistory={setShowHistory}
          />
        )}

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 pt-4 border-t border-sand/10 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-sand/50"
        >
          <span>Filene lagres kryptert og slettes automatisk</span>
          <a
            href="https://involve.no"
            className="flex items-center gap-2 hover:text-brand transition-colors ml-auto"
          >
            <Globe size={15} />
            <span>involve.no</span>
          </a>
          <span className="hover:text-brand transition-colors cursor-pointer">
            Vilkår og personvern
          </span>
          {appVersion && (
            <span className="text-sand/35" title="Appversjon">
              v{appVersion}
            </span>
          )}
        </motion.footer>
      </main>
    </div>
  );
}

export default App;