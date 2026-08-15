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
import { isDesktop } from './lib/api';
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
    <div className="bg-[#030712] h-screen w-screen text-white p-5 overflow-y-auto border border-white/10 custom-scrollbar select-none">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <History className="text-[#c4d600]" size={18} /> Historikk
        </h2>
        <button
          onClick={handleOpenMain}
          className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
        >
          <Maximize2 size={18} />
        </button>
      </div>

      {history.length === 0 ? (
        <p className="text-slate-500 text-sm text-center mt-10">Ingen overføringer ennå.</p>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div key={item.id} className="bg-white/5 border border-white/10 p-3 rounded-xl flex flex-col gap-3 group hover:bg-white/10 transition-colors">
              <div className="overflow-hidden pr-2">
                <p className="text-white font-medium truncate text-sm">{item.fileName}</p>
                <p className="text-slate-500 text-xs mt-0.5">{item.date}</p>
              </div>

              <button
                onClick={() => handleCopyLink(item.url, item.id)}
                className="flex items-center justify-center gap-2 px-3 py-2 w-full bg-[#c4d600]/10 text-[#c4d600] rounded-lg hover:bg-[#c4d600] hover:text-black transition-colors font-bold text-sm"
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

  // Gate the web app behind Google sign-in. The desktop app can't use Google
  // Identity Services — a tauri:// window isn't a valid authorised origin — so
  // it keeps the email-code flow until it gets the loopback OAuth treatment.
  if (!isDesktop() && !session) {
    return <LoginScreen onSignedIn={handleSignedIn} />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8 md:px-10 md:py-12 bg-ink text-sand">
      <main className="w-full max-w-3xl flex-1 flex flex-col">
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center text-center mb-10"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="w-9 h-9 rounded-md bg-brand text-ink-deep flex items-center justify-center text-xl font-bold leading-none"
            >
              I
            </span>
            <h1 className="text-xl font-bold tracking-wide text-sand leading-none">
              drop.involve.no
            </h1>
          </div>
          <p className="text-sm text-sand/60 mt-3">
            Sikre og raske filoverføringer
          </p>

          {session?.user && (
            <div className="mt-5 flex items-center gap-3 text-sm">
              <span className="text-sand/70">
                {session.user.name || session.user.email}
              </span>
              <span aria-hidden="true" className="text-sand/25">•</span>
              <button
                onClick={handleSignOut}
                className="text-sand/50 hover:text-brand transition-colors"
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
          className="mt-10 pt-6 border-t border-sand/10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-sand/50"
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