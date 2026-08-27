
import JSZip from 'jszip'; // <--- ADD THIS
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileCheck, Copy, Loader2, Link as LinkIcon,
  AlertCircle, X, Mail, MessageSquare, CheckCircle2,
  Clock, Send, Lock, Trash2, History as HistoryIcon
} from 'lucide-react';
import { API_BASE } from '../lib/api';
import { uploadInParts, MULTIPART_THRESHOLD } from '../lib/multipart';

const formatWhen = (timestamp) =>
  new Date(timestamp).toLocaleString('no-NO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

/**
 * Names a multi-file bundle after its first file plus a count, e.g.
 * "Rapport_og_3_flere.zip".
 *
 * The previous fixed name told the recipient nothing — not what was inside,
 * nor which batch it was when several arrived the same day.
 */
const MAX_SIZE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

const sanitiseBase = (value) =>
  String(value)
    .replace(/[^\p{L}\p{N} _-]/gu, '')  // keep letters, numbers, space, _ and -
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40);

const zipNameFor = (files) => {
  const base = sanitiseBase(files[0].name.replace(/\.[^.]+$/, ''));
  const others = files.length - 1;
  const suffix = others === 1 ? 'og_1_til' : `og_${others}_flere`;
  return `${base || 'Filer'}_${suffix}.zip`;
};

/**
 * Walks a dropped directory into a flat list of files, each carrying the path
 * it had inside the folder so the zip can rebuild the structure.
 *
 * A dropped folder arrives in `dataTransfer.files` as a single zero-byte entry
 * that isn't a real file. Uploading it failed at the PUT, which is what people
 * were seeing. The directory contents are only reachable through the entries
 * API, so that's what this uses.
 */
const readEntries = (reader) =>
  new Promise((resolve, reject) => reader.readEntries(resolve, reject));

const walkEntry = async (entry, prefix, out) => {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ file, path: `${prefix}${file.name}` });
    return;
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries hands back at most 100 children per call and signals the end
    // with an empty array, so a single call silently truncates large folders.
    let batch;
    do {
      batch = await readEntries(reader);
      for (const child of batch) {
        await walkEntry(child, `${prefix}${entry.name}/`, out);
      }
    } while (batch.length > 0);
  }
};

const collectDroppedEntries = async (entries) => {
  const out = [];
  for (const entry of entries) {
    if (entry) await walkEntry(entry, '', out);
  }
  return out;
};

/**
 * Must produce byte-identical output to the server's version — this value is
 * part of the presigned signature, so a mismatch fails the upload.
 */
const contentDispositionFor = (fileName) => {
  const ascii = String(fileName).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatDuration = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)} sek`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} t ${Math.round((seconds % 3600) / 60)} min`;
};

/**
 * PUT with progress reporting.
 *
 * fetch() cannot report upload progress — there's no event for it — which is
 * why the old progress bar was hardcoded to slide to 70%. XMLHttpRequest can,
 * and it can also be aborted, which makes a cancel button possible.
 */
const putWithProgress = (url, file, { headers, onProgress, xhrRef }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (xhrRef) xhrRef.current = xhr;

    xhr.open('PUT', url);
    Object.entries(headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };

    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Opplasting feilet (${xhr.status})`));

    xhr.onerror = () => reject(new Error('Nettverksfeil under opplasting.'));
    xhr.ontimeout = () => reject(new Error('Opplastingen tok for lang tid.'));
    xhr.onabort = () => reject(Object.assign(new Error('Avbrutt'), { aborted: true }));

    xhr.send(file);
  });

/**
 * @param {object} props
 * @param {{token: string, user: {email: string, name?: string}}} props.session
 *   Always present — App renders the sign-in screen instead when it isn't.
 * @param {boolean} props.showHistory
 * @param {(open: boolean) => void} props.setShowHistory
 *   Owned by App because the button that opens the panel lives in the header —
 *   in the card it competed for width with the mode toggle and wrapped onto a
 *   second row under Windows display scaling.
 */
const UploadCard = ({ session, showHistory, setShowHistory }) => {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('IDLE'); // IDLE, UPLOADING, SUCCESS, ERROR
  const [transferMode, setTransferMode] = useState('EMAIL'); // EMAIL, LINK
  const [downloadUrl, setDownloadUrl] = useState('');
  const [requireReceipt, setRequireReceipt] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  // Always known: nothing renders until the user has signed in.
  const emailFrom = session.user.email;
  const [emailTo, setEmailTo] = useState('');
  // Server-held, so the same suggestions appear on the website and in the app.
  const [savedContacts, setSavedContacts] = useState([]);
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState(7);
  const [linkPassword, setLinkPassword] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // A ref rather than state: the token is issued and used inside one async
  // function, so it must be readable immediately, and nothing renders from it.
  // Seeded from the Google session when there is one. No effect keeps these in
  // sync because the session can't change while this component is mounted —
  // App renders the login screen instead when it's absent, and signing out
  // unmounts us.
  const sessionTokenRef = useRef(session?.token || null);
  // --- HISTORY ---
  // Held on the server, keyed to the Google account, so it's the same list on
  // the website and in the desktop app. It used to live in localStorage, which
  // is scoped per origin — tauri://localhost and drop.involve.no are separate
  // stores, so the two never matched.
  const [history, setHistory] = useState([]);
  const [historyState, setHistoryState] = useState('loading'); // loading | ready | error
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  // Real transfer progress, replacing the bar that always animated to 70%.
  const [progress, setProgress] = useState({ loaded: 0, total: 0, bytesPerSecond: 0 });
  const [zipProgress, setZipProgress] = useState(0);
  const xhrRef = useRef(null);
  const folderInputRef = useRef(null);
  // Multipart runs several requests at once; cancelling has to abort them all.
  const activeUploadsRef = useRef(new Set());

  // Filter on the address currently being typed — the part after the last
  // comma — and hide any already in the field. With nothing typed, show the
  // most recent so the list is useful before you start.
  const contactSuggestions = (() => {
    const alreadyChosen = new Set(
      emailTo.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean)
    );
    const typing = emailTo.split(',').pop().trim().toLowerCase();

    return savedContacts
      .filter((contact) => {
        const value = contact.toLowerCase();
        if (value === typing) return false;
        if (typing.length === 0) return !alreadyChosen.has(value);
        return value.includes(typing);
      })
      .slice(0, 8);
  })();

  // Two levels on purpose. Too short is an error and blocks sending, because
  // the server rejects it anyway. Weak-but-allowed is a warning: complexity
  // rules mostly produce passwords written on sticky notes, so we advise
  // rather than forbid.
  const passwordIssue = (() => {
    if (!linkPassword) return null;

    if (linkPassword.length < 6) {
      return { level: 'error', text: 'Minst 6 tegn.' };
    }

    const hasLetter = /\p{L}/u.test(linkPassword);
    const hasNumber = /\d/.test(linkPassword);

    if (!hasLetter || !hasNumber) {
      return { level: 'warn', text: 'Svakt passord — bruk både bokstaver og tall.' };
    }
    if (linkPassword.length < 8) {
      return { level: 'warn', text: 'Kort passord — 8 tegn eller mer er tryggere.' };
    }

    return { level: 'ok', text: 'Del passordet med mottakeren på en annen måte enn e-post.' };
  })();

  const passwordBlocks = passwordIssue?.level === 'error';

  const percent = progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : 0;

  // Only once there's a rate to extrapolate from — an estimate in the first
  // half-second is meaningless and jumps around.
  const secondsLeft = progress.bytesPerSecond > 0 && progress.total > progress.loaded
    ? (progress.total - progress.loaded) / progress.bytesPerSecond
    : null;

  const authHeaders = () =>
    sessionTokenRef.current ? { Authorization: `Bearer ${sessionTokenRef.current}` } : {};

  // No synchronous setState here: the state already starts as 'loading', and
  // setting it again on mount would be a render-cascade the linter rightly
  // objects to. reloadHistory below adds it back for manual retries.
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/history`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Kunne ikke hente historikk.');
      const { items } = await res.json();
      setHistory(Array.isArray(items) ? items : []);
      setHistoryState('ready');
    } catch {
      setHistoryState('error');
    }
  }, []);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/contacts`, { headers: authHeaders() });
      if (!res.ok) return;
      const { items } = await res.json();
      setSavedContacts(Array.isArray(items) ? items : []);
    } catch {
      // Suggestions are a convenience; failing to load them isn't worth
      // surfacing an error over.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  const loadHistory = useCallback(() => {
    setHistoryState('loading');
    return fetchHistory();
  }, [fetchHistory]);

  // Opening the panel is the moment the list needs to be current — a transfer
  // sent from the website won't otherwise show up in an app that's been open.
  // Same for returning to the window, refreshed quietly so the list doesn't
  // flash a loading state at someone mid-read.
  useEffect(() => {
    if (!showHistory) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchHistory();

    const onFocus = () => fetchHistory();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [showHistory, fetchHistory]);

  useEffect(() => {
    // The lint rule flags any state-setting call from an effect, but every
    // setState in fetchHistory happens after an await — which is exactly how
    // data loading is meant to work, and causes no render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchHistory();
  }, [fetchHistory]);

  const revokeLink = async (shortId) => {
    setRevoking(shortId);
    try {
      const res = await fetch(`${API_BASE}/history/${encodeURIComponent(shortId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error();
      setHistory((items) => items.filter((item) => item.id !== shortId));
    } catch {
      setHistoryState('error');
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileValidation = (selectedFile) => {
    if (!selectedFile) return;

    if (selectedFile.size > MAX_SIZE_BYTES) {
      setError('Filen er for stor. Maks grense er 20 GB.');
      setStatus('ERROR');
      setFile(null);
      return;
    }

    // If it passes, clear any errors and set the file
    setError('');
    setStatus('IDLE');
    setFile(selectedFile);
  };

  /**
   * Takes {file, path} pairs rather than a bare FileList, because a folder only
   * makes sense with the paths kept — otherwise two files called the same thing
   * in different subfolders overwrite each other in the zip.
   */
  const processEntries = async (items, { rootName } = {}) => {
    if (!items || items.length === 0) {
      setError('Fant ingen filer å laste opp. Mappen kan være tom.');
      setStatus('ERROR');
      return;
    }

    const hasFolders = items.some(({ path }) => path.includes('/'));

    // A single loose file still uploads as itself — zipping it would only make
    // the recipient unpack something for no reason.
    if (items.length === 1 && !hasFolders) {
      handleFileValidation(items[0].file);
      return;
    }

    // Checked before zipping, not after: JSZip builds the archive in memory, so
    // a folder well over the cap would exhaust the tab before we ever got a
    // size to reject.
    const totalBytes = items.reduce((sum, { file }) => sum + file.size, 0);
    if (totalBytes > MAX_SIZE_BYTES) {
      setError(`Innholdet er ${formatBytes(totalBytes)}. Maks grense er 20 GB.`);
      setStatus('ERROR');
      return;
    }

    setStatus('ZIPPING'); // Shows a loading screen
    try {
      const zip = new JSZip();
      items.forEach(({ file, path }) => {
        zip.file(path, file);
      });

      setZipProgress(0);
      const zipContent = await zip.generateAsync({ type: 'blob' }, (metadata) =>
        setZipProgress(metadata.percent)
      );

      // Named after the folder when there is one, so the recipient recognises it.
      const name = rootName
        ? `${sanitiseBase(rootName) || 'Mappe'}.zip`
        : zipNameFor(items.map(({ file }) => file));

      // Convert the blob into a File object so the rest of your app knows how to handle it
      const zipFile = new File([zipContent], name, { type: 'application/zip' });

      handleFileValidation(zipFile);
    } catch {
      setError('Kunne ikke komprimere filene. Prøv igjen.');
      setStatus('ERROR');
    }
  }; const handleCopyLink = (url, id) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000); // Change back to copy icon after 2 seconds
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    // webkitGetAsEntry has to be called synchronously: the DataTransfer is
    // emptied as soon as this handler returns, so anything read after an await
    // comes back null.
    const entries = Array.from(e.dataTransfer.items || [])
      .filter((item) => item.kind === 'file')
      .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
      .filter(Boolean);

    if (entries.length === 0) {
      // Older browsers without the entries API. Folders still won't work there,
      // but loose files carry on as before.
      const items = Array.from(e.dataTransfer.files).map((file) => ({ file, path: file.name }));
      processEntries(items);
      return;
    }

    const rootName =
      entries.length === 1 && entries[0].isDirectory ? entries[0].name : null;

    // Only show the zipping screen when there's actually something to walk —
    // a single dropped file resolves instantly and would just flash it.
    if (entries.length > 1 || entries[0].isDirectory) {
      setStatus('ZIPPING');
      setZipProgress(0);
    }

    collectDroppedEntries(entries)
      .then((items) => processEntries(items, { rootName }))
      .catch(() => {
        setError('Kunne ikke lese mappen. Prøv igjen.');
        setStatus('ERROR');
      });
  };

  const handleFileSelect = (e) => {
    // A folder picked through the dialog arrives already flattened, with the
    // structure in webkitRelativePath.
    const files = Array.from(e.target.files || []);
    const items = files.map((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
    }));
    const rootName = files[0]?.webkitRelativePath
      ? files[0].webkitRelativePath.split('/')[0]
      : null;

    processEntries(items, { rootName });
    // Lets the same folder be picked twice in a row.
    e.target.value = '';
  };

  const startTransfer = async () => {
    if (!file) return;
    uploadFile(file);
  };

  const uploadFile = async (fileToUpload) => {
    setError('');


    // ... rest of upload logic (generate URL, etc.)

    setStatus('UPLOADING');
    try {
      const startedAt = Date.now();
      setProgress({ loaded: 0, total: fileToUpload.size, bytesPerSecond: 0 });

      const track = (loaded, total) => {
        const elapsed = (Date.now() - startedAt) / 1000;
        setProgress({
          loaded,
          total,
          bytesPerSecond: elapsed > 0.5 ? loaded / elapsed : 0,
        });
      };

      let objectKey;

      if (fileToUpload.size > MULTIPART_THRESHOLD) {
        // R2 rejects a single PUT over 4.995 GiB, and even below that a large
        // upload benefits from parallel parts and per-part retries.
        objectKey = await uploadInParts(fileToUpload, {
          authHeaders,
          onProgress: track,
          activeUploads: activeUploadsRef,
        });
      } else {
        const res = await fetch(`${API_BASE}/generate-upload-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            contentType: fileToUpload.type || 'application/octet-stream',
            fileName: fileToUpload.name,
          })
        });

        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          throw new Error(detail.error || 'Kunne ikke starte opplastingen.');
        }
        const body = await res.json();
        objectKey = body.objectKey;

        await putWithProgress(body.uploadUrl, fileToUpload, {
          xhrRef,
          headers: {
            'Content-Type': fileToUpload.type || 'application/octet-stream',
            'Content-Disposition': contentDispositionFor(fileToUpload.name),
          },
          onProgress: track,
        });
      }

      const expiresInSeconds = expiry * 24 * 60 * 60;
      // POST rather than GET: a link password must not travel in a query
      // string, where it would end up in server logs and browser history.
      const downloadRes = await fetch(`${API_BASE}/generate-download-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          objectKey,
          expiresIn: expiresInSeconds,
          fileName: fileToUpload.name,
          // Stored on the link so the landing page can show what the recipient
          // is about to download. /s/:id is public and has no session to look
          // any of this up from.
          fileSize: fileToUpload.size,
          message: transferMode === 'EMAIL' ? message : '',
          password: linkPassword || undefined,
        }),
      });
      if (!downloadRes.ok) {
        // The server's message is the useful one — it says things like
        // "Passordet må ha minst 6 tegn." Throwing a generic string here meant
        // a correct validation error arrived and was silently discarded.
        const detail = await downloadRes.json().catch(() => ({}));
        throw new Error(detail.error || 'Kunne ikke lage nedlastingslenke.');
      }
      const { downloadUrl } = await downloadRes.json();

      setDownloadUrl(downloadUrl);
      setStatus('SUCCESS');

      // The server recorded this against the account already; just refresh.
      loadHistory();

      // --- NEW EMAIL LOGIC ---
      if (transferMode === 'EMAIL' && emailTo && emailFrom) {
        try {
          await fetch(`${API_BASE}/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
              emailTo,
              message,
              downloadUrl,
              fileName: fileToUpload.name,
              requireReceipt,
              // So the email can state the real expiry and mention the
              // password, rather than assuming seven days and staying silent.
              expiryDays: expiry,
              hasPassword: Boolean(linkPassword),
            })
          });
          // Recipients are remembered server-side by /send-email.
          fetchContacts();
        } catch (emailErr) {
          console.error("Email failed to send, but file was uploaded:", emailErr);
          // We don't setStatus('ERROR') here because the file upload actually worked.
        }
      }
      // -----------------------

    } catch (err) {
      // Cancelling isn't a failure — reset() has already returned us to IDLE.
      if (err.aborted) return;
      console.error(err);
      setError(err.message);
      setStatus('ERROR');
    }
  };

  const cancelTransfer = () => {
    xhrRef.current?.abort();
    xhrRef.current = null;

    // Multipart has several in flight at once.
    activeUploadsRef.current.forEach((xhr) => xhr.abort());
    activeUploadsRef.current.clear();

    setProgress({ loaded: 0, total: 0, bytesPerSecond: 0 });
    setStatus('IDLE');
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(downloadUrl);
  };

  const reset = () => {
    setFile(null);
    setStatus('IDLE');
    setDownloadUrl('');
    setError('');
    setEmailTo('');
    setMessage('');
    setLinkPassword('');
    setProgress({ loaded: 0, total: 0, bytesPerSecond: 0 });
    setZipProgress(0);
    xhrRef.current = null;
  };

  return (
    <div className="flex flex-col items-center w-full">
      <motion.div
        layout
        // A short tween rather than framer's default spring: the card resizes
        // when switching modes, and a spring overshoots on something this large.
        transition={{ layout: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } }}
        className={`w-full surface rounded-2xl p-5 md:p-6 flex flex-col items-center justify-center transition-colors duration-200 relative overflow-hidden min-h-[260px] ${isDragging ? 'border-brand' : ''
          }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >

        {/* --- 2. HISTORY PANEL --- */}
        {showHistory && (
          <div className="w-full h-full flex flex-col min-h-[280px] z-10">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-base font-medium text-sand flex items-center gap-2">
                <HistoryIcon className="text-brand" size={18} /> Tidligere overføringer
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                aria-label="Lukk historikk"
                className="text-sand/60 hover:text-sand hover:bg-sand/5 p-2 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
              {historyState === 'loading' && (
                <p className="text-sand/50 text-sm text-center py-8">Henter historikk…</p>
              )}

              {historyState === 'error' && (
                <p className="text-rose-400/80 text-sm text-center py-8">
                  Kunne ikke hente historikken.{' '}
                  <button onClick={loadHistory} className="underline hover:text-rose-300">
                    Prøv igjen
                  </button>
                </p>
              )}

              {historyState === 'ready' && history.length === 0 && (
                <p className="text-sand/50 text-sm text-center py-8">Ingen overføringer ennå.</p>
              )}

              {historyState === 'ready' && history.map((item) => (
                <div key={item.id} className="surface-inset p-3 rounded-lg flex items-center gap-3 w-full">
                  <div className="overflow-hidden flex-1 min-w-0">
                    <p className="text-sand font-medium truncate text-sm">{item.fileName}</p>
                    <p className="text-sand/50 text-xs mt-0.5">
                      {formatWhen(item.createdAt)}
                      {item.hasPassword && ' · passordbeskyttet'}
                    </p>
                    <p className={`text-xs mt-0.5 ${item.downloads ? 'text-mint' : 'text-sand/40'}`}>
                      {!item.downloads && 'Ikke lastet ned ennå'}
                      {item.downloads === 1 && 'Lastet ned 1 gang'}
                      {item.downloads > 1 && `Lastet ned ${item.downloads} ganger`}
                    </p>
                  </div>

                  {confirmRevoke === item.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-sand/60 hidden sm:inline">Slette?</span>
                      <button
                        onClick={() => revokeLink(item.id)}
                        disabled={revoking === item.id}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 transition-colors text-xs font-medium disabled:opacity-50"
                      >
                        {revoking === item.id ? 'Sletter…' : 'Ja, slett'}
                      </button>
                      <button
                        onClick={() => setConfirmRevoke(null)}
                        className="px-2.5 py-1.5 rounded-lg text-sand/60 hover:text-sand hover:bg-sand/5 transition-colors text-xs"
                      >
                        Avbryt
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleCopyLink(item.url, item.id)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand/10 text-brand rounded-lg hover:bg-brand hover:text-ink-deep transition-colors font-medium text-xs"
                      >
                        {copiedId === item.id ? (
                          <><CheckCircle2 size={14} /> Kopiert</>
                        ) : (
                          <><Copy size={14} /> Kopier</>
                        )}
                      </button>
                      <button
                        onClick={() => setConfirmRevoke(item.id)}
                        aria-label="Trekk tilbake lenken"
                        title="Trekk tilbake lenken"
                        className="p-1.5 rounded-lg text-sand/40 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* --- 3. UPDATED IDLE CHECK (Added !showHistory) --- */}
          {!showHistory && status === 'IDLE' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col md:flex-row items-stretch gap-5 w-full"
            >
              {/* Left column: mode toggle sits directly above the drop zone
                  rather than in its own full-width row, so the form column on
                  the right starts at the same height and the card loses a row. */}
              <div className="flex-1 w-full flex flex-col gap-3">
                {/* The two buttons share the column width rather than sizing to
                    their own text, so they can't wrap onto a second row when a
                    machine renders text larger than we assumed. */}
                <div className="flex w-full bg-sand/5 p-1 rounded-lg">
                  <button
                    onClick={() => setTransferMode('EMAIL')}
                    className={`flex-1 min-w-0 px-2 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${transferMode === 'EMAIL' ? 'bg-brand text-ink-deep' : 'text-sand/60 hover:text-sand'}`}
                  >
                    <Send size={15} className="shrink-0" /> Send e-post
                  </button>
                  <button
                    onClick={() => setTransferMode('LINK')}
                    className={`flex-1 min-w-0 px-2 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${transferMode === 'LINK' ? 'bg-brand text-ink-deep' : 'text-sand/60 hover:text-sand'}`}
                  >
                    <LinkIcon size={15} className="shrink-0" /> Hent lenke
                  </button>
                </div>
                <label
                  data-dragging={isDragging}
                  className="dropzone cursor-pointer flex flex-1 flex-col items-center rounded-xl p-4 min-h-[150px] justify-center relative overflow-hidden"
                >
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-3 transition-colors overflow-hidden ${file ? 'bg-mint text-ink' : 'bg-brand text-ink-deep'}`}>
                    {file ? (
                      file.type.startsWith('image/') ? (
                        <img src={URL.createObjectURL(file)} alt="Forhåndsvisning" className="w-full h-full object-cover" />
                      ) : (
                        <FileCheck size={22} />
                      )
                    ) : (
                      <Upload size={22} />
                    )}
                  </div>
                  <h3 className="text-base font-medium text-sand mb-1">{file ? 'Fil valgt' : 'Slipp filer eller mapper her'}</h3>
                  <p className="text-sand/50 text-xs text-center max-w-[220px] truncate">
                    {file ? file.name : 'eller klikk for å bla gjennom'}
                  </p>
                  <input type="file" multiple className="hidden" onChange={handleFileSelect} />
                </label>

                {/* Outside the label on purpose: a button nested inside one
                    triggers that label's file input instead of its own. */}
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="text-sand/60 hover:text-sand text-xs underline underline-offset-2 transition-colors"
                >
                  Velg en mappe i stedet
                </button>
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  webkitdirectory=""
                  directory=""
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {/* Form Side */}
              <div className="flex-1 w-full space-y-3">
                <AnimatePresence mode="popLayout">
                  {transferMode === 'EMAIL' && (
                    <motion.div
                      // Opacity only. Animating height to 'auto' re-measures the
                      // element every frame and fights the parent's layout
                      // animation over the same resize — that was the jitter.
                      // popLayout takes the exiting element out of flow, so the
                      // card still shrinks smoothly without animating height here.
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-3 overflow-visible"
                    >
                      {/* Send To Field with Autocomplete Dropdown */}
                      <div className="relative z-50">
                        <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sand/70" size={18} />
                        <input
                          type="text"
                          placeholder="Send til (bruk komma for flere)"
                          value={emailTo}
                          onChange={(e) => {
                            setEmailTo(e.target.value);
                            setIsDropdownOpen(true);
                          }}
                          // Suggestions on focus too, not just while typing —
                          // most sends go to someone you've used before, so the
                          // list should be reachable without guessing a letter.
                          onFocus={() => setIsDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)} // Delay allows click to register
                          className="w-full field rounded-lg py-2.5 pl-11 pr-4 text-sand focus:outline-none"
                        />

                        {isDropdownOpen && contactSuggestions.length > 0 && (
                          <div className="absolute top-full left-0 w-full mt-2 bg-ink-deep border border-sand/10 rounded-xl overflow-hidden max-h-56 overflow-y-auto custom-scrollbar">
                            {contactSuggestions.map(contact => (
                              <button
                                key={contact}
                                type="button"
                                onClick={() => {
                                  const parts = emailTo.split(',');
                                  parts.pop(); // Remove the partially typed email
                                  const newVal = parts.length > 0
                                    ? parts.map(p => p.trim()).filter(Boolean).concat(contact).join(', ') + ', '
                                    : `${contact}, `;
                                  setEmailTo(newVal);
                                  setIsDropdownOpen(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-sm text-sand/80 hover:bg-brand/20 hover:text-sand transition-colors border-b border-sand/10 last:border-0"
                              >
                                {contact}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* The message only travels with an email, so it's hidden when
                    the user just wants a link. */}
                {transferMode === 'EMAIL' && (
                  <div className="relative">
                    <MessageSquare className="absolute left-3.5 top-3.5 text-sand/70" size={18} />
                    <textarea
                      placeholder="Din melding"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full field rounded-lg py-2.5 pl-11 pr-4 text-sand min-h-[80px] resize-none focus:outline-none"
                    />
                  </div>
                )}

                {/* NEW RECEIPT OPT-IN CHECKBOX */}
                {transferMode === 'EMAIL' && (
                  <label className="flex items-center gap-3 text-sm text-sand/80 cursor-pointer w-fit hover:text-sand transition-colors">
                    <input
                      type="checkbox"
                      checked={requireReceipt}
                      onChange={(e) => setRequireReceipt(e.target.checked)}
                      className="w-4 h-4 accent-[#F5FF8C] cursor-pointer"
                    />
                    Få varsel på e-post når filen lastes ned
                  </label>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex-1 relative">
                    <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sand/70" size={18} />
                    <select
                      value={expiry}
                      onChange={(e) => setExpiry(Number(e.target.value))}
                      className="w-full bg-sand/5 border border-sand/10 rounded-xl py-4 pl-12 pr-4 text-sand appearance-none focus:outline-none focus:border-brand/50 transition-all cursor-pointer"
                    >
                      <option value={1} className="bg-ink">Utløper om 1 dag</option>
                      <option value={3} className="bg-ink">Utløper om 3 dager</option>
                      <option value={7} className="bg-ink">Utløper om 7 dager</option>
                    </select>
                  </div>
                </div>

                {/* Optional password. Deliberately not sent in the email — the
                    point is that it travels by a different route. */}
                <div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sand/70" size={18} />
                    <input
                      type="password"
                      placeholder="Passord på lenken (valgfritt)"
                      value={linkPassword}
                      onChange={(e) => setLinkPassword(e.target.value)}
                      minLength={6}
                      autoComplete="new-password"
                      aria-invalid={passwordBlocks}
                      className={`w-full field rounded-lg py-2.5 pl-11 pr-4 text-sand focus:outline-none ${passwordBlocks ? 'border-rose-400/60' : ''}`}
                    />
                  </div>

                  {/* Always rendered. Showing and hiding it shifted everything
                      below as you typed, which read as flickering. */}
                  <p className={`text-xs mt-2 ml-1 ${passwordIssue?.level === 'error'
                    ? 'text-rose-400'
                    : passwordIssue?.level === 'warn'
                      ? 'text-brand/80'
                      : 'text-sand/50'
                    }`}>
                    {passwordIssue?.text || 'Minst 6 tegn, helst bokstaver og tall.'}
                  </p>
                </div>

                <button
                  onClick={startTransfer}
                  disabled={!file || passwordBlocks}
                  title={passwordBlocks ? 'Passordet er for kort' : undefined}
                  className={`w-full mt-1 px-6 py-3 font-medium text-base rounded-xl transition-colors active:scale-[0.99] flex items-center justify-center gap-2 ${file && !passwordBlocks
                    ? 'bg-brand text-ink-deep hover:bg-brand/90'
                    : 'bg-sand/5 text-sand/40 cursor-not-allowed'
                    }`}
                >
                  {transferMode === 'EMAIL' ? <Send size={18} /> : <LinkIcon size={18} />}
                  {transferMode === 'EMAIL' ? 'Overfør via e-post' : 'Hent lenke'}
                </button>
              </div>
            </motion.div>
          )}

          {status === 'ZIPPING' && (
            <motion.div
              key="zipping"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-center w-full max-w-md"
            >
              <div className="w-14 h-14 rounded-xl bg-brand/10 flex items-center justify-center mb-4">
                <Loader2 size={26} className="text-brand animate-spin" />
              </div>
              <h3 className="text-lg font-medium text-sand mb-1">Komprimerer filer</h3>
              <p className="text-sand/60 text-sm mb-5 text-center">Gjør klar en .zip-fil for overføring</p>

              <div className="w-full bg-sand/5 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand transition-[width] duration-200"
                  style={{ width: `${Math.round(zipProgress)}%` }}
                />
              </div>
              <p className="text-sand/50 text-xs mt-2">{Math.round(zipProgress)} %</p>
            </motion.div>
          )}

          {status === 'UPLOADING' && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-center w-full max-w-md"
            >
              <div className="w-14 h-14 rounded-xl bg-brand/10 flex items-center justify-center mb-4">
                <Loader2 size={26} className="text-brand animate-spin" />
              </div>

              <h3 className="text-lg font-medium text-sand mb-1">Overfører</h3>
              <p className="text-sand/60 text-sm mb-5 truncate w-full text-center">{file?.name}</p>

              <div className="w-full flex items-baseline justify-between mb-1.5">
                <span className="text-2xl font-medium text-sand tabular-nums">{percent} %</span>
                {progress.total > 0 && (
                  <span className="text-xs text-sand/50 tabular-nums">
                    {formatBytes(progress.loaded)} av {formatBytes(progress.total)}
                  </span>
                )}
              </div>

              <div className="w-full bg-sand/5 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="w-full flex items-center justify-between mt-2 text-xs text-sand/50 tabular-nums min-h-[16px]">
                <span>{progress.bytesPerSecond > 0 && `${formatBytes(progress.bytesPerSecond)}/s`}</span>
                <span>{secondsLeft !== null && `ca. ${formatDuration(secondsLeft)} igjen`}</span>
              </div>

              <button
                onClick={cancelTransfer}
                className="mt-6 flex items-center gap-2 text-sm text-sand/50 hover:text-sand transition-colors"
              >
                <X size={15} /> Avbryt
              </button>
            </motion.div>
          )}

          {status === 'SUCCESS' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center w-full max-w-md"
            >
              <div className="w-14 h-14 rounded-full bg-mint/15 flex items-center justify-center mb-4 text-mint">
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-lg font-medium text-sand mb-1 text-center">Fullført</h3>
              <p className="text-sand/60 text-sm mb-5 text-center">
                {transferMode === 'EMAIL' ? 'E-posten er sendt og filen er klar' : 'Filen din er klar for deling'}
              </p>

              <div className="w-full surface-inset rounded-lg p-3 mb-4 flex items-center gap-3">
                <LinkIcon size={17} className="text-brand shrink-0" />
                <p className="text-sand/90 text-sm truncate flex-1 font-mono">{downloadUrl}</p>
                <button
                  onClick={copyToClipboard}
                  aria-label="Kopier lenke"
                  title="Kopier lenke"
                  className="p-2 hover:bg-brand/10 rounded-lg text-brand transition-colors shrink-0"
                >
                  <Copy size={17} />
                </button>
              </div>

              {linkPassword && (
                <p className="text-xs text-sand/50 mb-4 text-center">
                  Lenken er passordbeskyttet. Passordet blir ikke sendt til
                  mottakeren &mdash; du må gi det videre selv.
                </p>
              )}

              <button
                onClick={reset}
                className="text-sm text-sand/60 hover:text-sand transition-colors flex items-center gap-2"
              >
                <X size={16} /> Ny overføring
              </button>
            </motion.div>
          )}

          {status === 'ERROR' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center w-full max-w-md"
            >
              <div className="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center mb-4 text-rose-400">
                <AlertCircle size={26} />
              </div>
              <h3 className="text-lg font-medium text-sand mb-1">Noe gikk galt</h3>
              <p className="text-rose-400/80 text-sm text-center mb-5">{error || 'Kunne ikke fullføre overføringen.'}</p>

              <button
                onClick={reset}
                className="px-6 py-2.5 bg-sand/5 hover:bg-sand/10 text-sand rounded-lg font-medium text-sm transition-colors"
              >
                Prøv igjen
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

    </div>
  );
};

export default UploadCard;

