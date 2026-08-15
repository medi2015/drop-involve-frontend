import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Maximize2,
  History,
  Copy,
  CheckCircle2,
  CloudUpload,
  Globe
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import UploadCard from './components/UploadCard';
import LoginScreen from './components/LoginScreen';
import { readList, STORAGE_KEYS } from './lib/storage';
import { loadSession, saveSession, clearSession } from './lib/auth';
import { enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';

// --- TRAY COMPONENT ---
const TrayHistory = () => {
  const [history, setHistory] = useState([]);
  const [copiedId, setCopiedId] = useState(null);

  const loadHistory = () => {
    // Limit to the 100 most recent items to maintain performance.
    setHistory(readList(STORAGE_KEYS.history, 100));
  };

  useEffect(() => {
    loadHistory();
    window.addEventListener('storage', loadHistory);
    return () => window.removeEventListener('storage', loadHistory);
  }, []);

  useEffect(() => {
    const checkAutostart = async () => {
      const active = await isEnabled();
      if (!active) {
        await enable();
      }
    };
    checkAutostart();
  }, []);

  const handleOpenMain = async () => {
    try {
      const mainWindow = await WebviewWindow.getByLabel('main');
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
        await mainWindow.unminimize();
        await getCurrentWindow().hide();
      }
    } catch (err) {
      console.error("Failed to open main window:", err);
    }
  };

  const handleCopyLink = (url, id) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="bg-ink h-screen w-screen text-sand p-4 overflow-y-auto border border-sand/10 custom-scrollbar select-none">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-bold text-sand flex items-center gap-2">
          <History className="text-brand" size={17} /> Historikk
        </h2>
        <button
          onClick={handleOpenMain}
          aria-label="Åpne hovedvinduet"
          title="Åpne hovedvinduet"
          className="p-2 hover:bg-sand/10 rounded-lg text-sand/50 hover:text-sand transition-colors"
        >
          <Maximize2 size={17} />
        </button>
      </div>

      {history.length === 0 ? (
        <p className="text-sand/50 text-sm text-center mt-10">Ingen overføringer ennå.</p>
      ) : (
        <div className="space-y-2">
          {history.map((item) => (
            <div key={item.id} className="surface p-3 rounded-xl flex flex-col gap-2.5 hover:bg-sand/10 transition-colors">
              <div className="overflow-hidden pr-2">
                <p className="text-sand font-medium truncate text-sm">{item.fileName}</p>
                <p className="text-sand/50 text-xs mt-0.5">{item.date}</p>
              </div>

              <button
                onClick={() => handleCopyLink(item.url, item.id)}
                className={`flex items-center justify-center gap-2 px-3 py-2 w-full rounded-lg transition-colors font-medium text-sm ${copiedId === item.id
                  ? 'bg-mint text-ink'
                  : 'bg-brand/10 text-brand hover:bg-brand hover:text-ink-deep'
                  }`}
              >
                {copiedId === item.id ? (
                  <><CheckCircle2 size={16} /> Kopiert</>
                ) : (
                  <><Copy size={16} /> Kopier lenke</>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// --- MAIN APP COMPONENT ---
const App = () => {
  const [isTray, setIsTray] = useState(false);
  // Restored synchronously so a signed-in user never sees the login screen
  // flash on load.
  const [session, setSession] = useState(() => loadSession());

  const handleSignedIn = (payload) => setSession(saveSession(payload));

  const handleSignOut = () => {
    clearSession();
    setSession(null);
  };

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

  // 2. TRAY WINDOW CHECK LOGIC
  useEffect(() => {
    try {
      if (window.__TAURI_INTERNALS__) {
        const appWindow = getCurrentWindow();
        if (appWindow.label === 'tray') {
          setIsTray(true);
        }
      }
    } catch (e) {
      console.error("Not running in Tauri or error getting window", e);
    }
  }, []);

  if (isTray) {
    return <TrayHistory />;
  }

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

          {session?.user && (
            <div className="ml-auto flex items-center gap-3 text-sm min-w-0">
              <span className="text-sand/70 truncate">
                {session.user.name || session.user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="text-sand/50 hover:text-brand transition-colors shrink-0"
              >
                Logg ut
              </button>
            </div>
          )}
        </motion.header>

        <UploadCard session={session} />

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
        </motion.footer>
      </main>
    </div>
  );
}

export default App;