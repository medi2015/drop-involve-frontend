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
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'; // Best for v2
import UploadCard from './components/UploadCard';
import { enable, isEnabled } from '@tauri-apps/plugin-autostart';

// --- TRAY COMPONENT ---
const TrayHistory = () => {
  const [history, setHistory] = useState([]);
  const [copiedId, setCopiedId] = useState(null);

  const loadHistory = () => {
    const saved = localStorage.getItem('dropInvolveHistory');
    if (saved) setHistory(JSON.parse(saved));
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
        await enable(); // This turns it on for the user's computer
      }
    };
    checkAutostart();
  }, []);

  const handleOpenMain = async () => {
    try {
      // In Tauri v2, this is the most reliable way to target the main window
      const mainWindow = await WebviewWindow.getByLabel('main');
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
        await mainWindow.unminimize();
        // Hide the small tray popup
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

  useEffect(() => {
    try {
      // Check if we are running inside Tauri, then check the window label
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

  // If this is the tray window, ONLY render the TrayHistory component.
  if (isTray) {
    return <TrayHistory />;
  }

  // Otherwise, render the normal app!
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 md:p-10 overflow-hidden bg-[#030712] text-white">
      {/* Background Elements */}
      <div className="fixed inset-0 grid-pattern opacity-100 pointer-events-none" />

      <div className="orb w-[400px] h-[400px] bg-[#c4d600] bottom-[-50px] right-[-50px] animate-float opacity-5" />

      <main className="relative z-10 w-full flex flex-col items-center">
        <motion.header
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12 flex flex-col items-center"
        >
          <h1 className="text-4xl font-bold uppercase tracking-wider text-white mb-2">
            <span style={{ color: '#F4FE8B' }}>DROP</span>.INVOLVE.NO
          </h1>
          <p className="text-slate-400 font-medium text-lg">
            Sikre, raske og pålitelige filoverføringer
          </p>
        </motion.header>

        <UploadCard />

        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 flex flex-col items-center gap-2 text-slate-500 text-sm font-medium"
        >
          <p className="text-slate-600 mb-2">Files are encrypted with AES-256</p>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 hover:text-[#c4d600] transition-colors cursor-pointer">
              <Globe size={16} />
              <span>drop.involve.no</span>
            </div>
            <div className="w-1 h-1 bg-slate-700 rounded-full" />
            <span>Terms & Privacy</span>
          </div>
        </motion.footer>
      </main>
    </div>
  );
};

export default App;