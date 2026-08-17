import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Globe, History } from 'lucide-react';
import UploadCard from './components/UploadCard';
import LoginScreen from './components/LoginScreen';
import { loadSession, saveSession, clearSession } from './lib/auth';
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
  // Only meaningful in the desktop app — the website is always whatever was
  // last deployed, so a version number there would just be noise.
  const [appVersion, setAppVersion] = useState('');

  const handleSignedIn = (payload) => setSession(saveSession(payload));

  const handleSignOut = () => {
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
          <span
            aria-hidden="true"
            className="w-8 h-8 rounded-md bg-brand text-ink-deep flex items-center justify-center text-lg font-bold leading-none shrink-0"
          >
            I
          </span>
          <h1 className="text-base font-bold tracking-wide text-sand leading-none">
            drop.involve.no
          </h1>

          <div className="ml-auto flex items-center gap-4 text-sm min-w-0">
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 text-sand/60 hover:text-brand transition-colors shrink-0"
            >
              <History size={15} /> Historikk
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
              </>
            )}
          </div>
        </motion.header>

        <UploadCard
          session={session}
          showHistory={showHistory}
          setShowHistory={setShowHistory}
        />

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