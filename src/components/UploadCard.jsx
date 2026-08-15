
import JSZip from 'jszip'; // <--- ADD THIS
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileCheck, Copy, Loader2, Link as LinkIcon,
  AlertCircle, X, Mail, MessageSquare, CheckCircle2,
  Clock, Send, Lock, History as HistoryIcon
} from 'lucide-react';
import { readList, writeJson, STORAGE_KEYS } from '../lib/storage';
import { API_BASE } from '../lib/api';

const HISTORY_LIMIT = 25;

/**
 * Names a multi-file bundle after its first file plus a count, e.g.
 * "Rapport_og_3_flere.zip".
 *
 * The previous fixed name told the recipient nothing — not what was inside,
 * nor which batch it was when several arrived the same day.
 */
const zipNameFor = (files) => {
  const base = files[0].name
    .replace(/\.[^.]+$/, '')            // drop the extension
    .replace(/[^\p{L}\p{N} _-]/gu, '')  // keep letters, numbers, space, _ and -
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40);

  const others = files.length - 1;
  const suffix = others === 1 ? 'og_1_til' : `og_${others}_flere`;
  return `${base || 'Filer'}_${suffix}.zip`;
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
 * @param {{session: {token: string, user: {email: string, name?: string}}}} props
 *   Always present — App renders the sign-in screen instead when it isn't.
 */
const UploadCard = ({ session }) => {
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
  const [savedContacts, setSavedContacts] = useState(() => readList(STORAGE_KEYS.contacts));
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
  // --- HISTORY STATE ---
  const [showHistory, setShowHistory] = useState(false);
  // Only the 25 most recent. readList never throws, so corrupt storage costs
  // the user their history rather than the entire app.
  const [history, setHistory] = useState(() => readList(STORAGE_KEYS.history, HISTORY_LIMIT));
  const [copiedId, setCopiedId] = useState(null);
  // Real transfer progress, replacing the bar that always animated to 70%.
  const [progress, setProgress] = useState({ loaded: 0, total: 0, bytesPerSecond: 0 });
  const [zipProgress, setZipProgress] = useState(0);
  const xhrRef = useRef(null);

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

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileValidation = (selectedFile) => {
    if (!selectedFile) return;

    const MAX_SIZE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB

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

  const processFiles = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    // If it's just one file, process it normally
    if (files.length === 1) {
      handleFileValidation(files[0]);
      return;
    }

    // If multiple files, bundle them into a zip
    setStatus('ZIPPING'); // Shows a loading screen
    try {
      const zip = new JSZip();
      files.forEach(file => {
        zip.file(file.name, file);
      });

      setZipProgress(0);
      const zipContent = await zip.generateAsync({ type: 'blob' }, (metadata) =>
        setZipProgress(metadata.percent)
      );
      // Convert the blob into a File object so the rest of your app knows how to handle it
      const zipFile = new File([zipContent], zipNameFor(files), { type: 'application/zip' });

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
    processFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e) => {
    processFiles(e.target.files);
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
      const res = await fetch(`${API_BASE}/generate-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          // ADD THIS FALLBACK: || 'application/octet-stream'
          contentType: fileToUpload.type || 'application/octet-stream',
          fileName: fileToUpload.name,
        })
      });

      if (!res.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, objectKey } = await res.json();

      const startedAt = Date.now();
      setProgress({ loaded: 0, total: fileToUpload.size, bytesPerSecond: 0 });

      await putWithProgress(uploadUrl, fileToUpload, {
        xhrRef,
        headers: {
          'Content-Type': fileToUpload.type || 'application/octet-stream',
          'Content-Disposition': contentDispositionFor(fileToUpload.name),
        },
        onProgress: (loaded, total) => {
          const elapsed = (Date.now() - startedAt) / 1000;
          setProgress({
            loaded,
            total,
            bytesPerSecond: elapsed > 0.5 ? loaded / elapsed : 0,
          });
        },
      });

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
          password: linkPassword || undefined,
        }),
      });
      if (!downloadRes.ok) throw new Error('Failed to generate link');
      const { downloadUrl } = await downloadRes.json();

      setDownloadUrl(downloadUrl);
      setStatus('SUCCESS');

      // --- NEW HISTORY LOGIC ---
      const newTransfer = {
        id: Date.now(),
        fileName: fileToUpload.name,
        url: downloadUrl,
        date: new Date().toLocaleDateString('no-NO', {
          day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
      };

      // Newest first, capped so storage can't grow without bound
      const updatedHistory = [newTransfer, ...history].slice(0, HISTORY_LIMIT);
      setHistory(updatedHistory);
      writeJson(STORAGE_KEYS.history, updatedHistory);
      // -------------------------

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
              fileName: fileToUpload.name, // <--- ADD THIS HERE
              requireReceipt, // <--- ADD THIS LINE
            })
          });
          const newEmails = emailTo.split(/[,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'));
          const updatedContacts = [...new Set([...newEmails, ...savedContacts])].slice(0, 10); // Keeps the 10 most recent

          setSavedContacts(updatedContacts);
          writeJson(STORAGE_KEYS.contacts, updatedContacts);
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
              <h2 className="text-xl font-bold text-sand flex items-center gap-2">
                <HistoryIcon className="text-brand" /> Tidligere overføringer
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-sand/60 hover:text-sand bg-sand/5 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {history.map((item) => (
                <div key={item.id} className="bg-sand/5 border border-sand/10 p-4 rounded-xl flex items-center justify-between group hover:bg-sand/10 transition-colors w-full">
                  <div className="overflow-hidden pr-4 max-w-[60%]">
                    <p className="text-sand font-medium truncate text-sm">{item.fileName}</p>
                    <p className="text-sand/50 text-xs mt-1">{item.date}</p>
                  </div>

                  <button
                    onClick={() => handleCopyLink(item.url, item.id)}
                    className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-[#F5FF8C]/10 text-[#F5FF8C] rounded-lg hover:bg-[#F5FF8C] hover:text-ink-deep transition-colors font-medium text-sm"
                  >
                    {copiedId === item.id ? (
                      <><CheckCircle2 size={16} /> Kopiert</>
                    ) : (
                      <><Copy size={16} /> Kopier</>
                    )}
                  </button>
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
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex bg-sand/5 p-1 rounded-lg">
                    <button
                      onClick={() => setTransferMode('EMAIL')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${transferMode === 'EMAIL' ? 'bg-brand text-ink-deep' : 'text-sand/60 hover:text-sand'}`}
                    >
                      <Send size={15} /> Send e-post
                    </button>
                    <button
                      onClick={() => setTransferMode('LINK')}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${transferMode === 'LINK' ? 'bg-brand text-ink-deep' : 'text-sand/60 hover:text-sand'}`}
                    >
                      <LinkIcon size={15} /> Hent lenke
                    </button>
                  </div>

                  {history.length > 0 && (
                    <button
                      onClick={() => setShowHistory(true)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-sand/60 hover:text-sand hover:bg-sand/5 transition-colors"
                    >
                      <HistoryIcon size={15} /> Historikk
                    </button>
                  )}
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
                  <h3 className="text-base font-medium text-sand mb-1">{file ? 'Fil valgt' : 'Slipp filene her'}</h3>
                  <p className="text-sand/50 text-xs text-center max-w-[220px] truncate">
                    {file ? file.name : 'eller klikk for å bla gjennom'}
                  </p>
                  <input type="file" multiple className="hidden" onChange={handleFileSelect} />
                </label>
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
                          onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)} // Delay allows click to register
                          className="w-full field rounded-lg py-2.5 pl-11 pr-4 text-sand focus:outline-none"
                        />

                        {/* NEW DROPDOWN MENU */}
                        {isDropdownOpen && savedContacts.length > 0 && (
                          <div className="absolute top-full left-0 w-full mt-2 bg-ink-deep border border-sand/10 rounded-xl overflow-hidden">
                            {savedContacts
                              .filter(contact => {
                                // Only search the word currently being typed (after the last comma)
                                const currentSearch = emailTo.split(',').pop().trim().toLowerCase();
                                return currentSearch.length > 0 && contact.toLowerCase().includes(currentSearch) && contact.toLowerCase() !== currentSearch;
                              })
                              .map(contact => (
                                <button
                                  key={contact}
                                  type="button"
                                  onClick={() => {
                                    const parts = emailTo.split(',');
                                    parts.pop(); // Remove the partially typed email
                                    const newVal = parts.length > 0
                                      ? parts.map(p => p.trim()).join(', ') + `, ${contact}, `
                                      : `${contact}, `;
                                    setEmailTo(newVal);
                                    setIsDropdownOpen(false);
                                  }}
                                  className="w-full text-left px-4 py-3 text-sm text-sand/80 hover:bg-brand/20 hover:text-sand transition-colors border-b border-sand/10 last:border-0"
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
                      className="w-full field rounded-lg py-2.5 pl-11 pr-4 text-sand focus:outline-none"
                    />
                  </div>
                  {linkPassword && (
                    <p className="text-xs text-sand/50 mt-2 ml-1">
                      {linkPassword.length < 6
                        ? 'Minst 6 tegn.'
                        : 'Del passordet med mottakeren på en annen måte enn e-post.'}
                    </p>
                  )}
                </div>

                <button
                  onClick={startTransfer}
                  disabled={!file}
                  className={`w-full mt-1 px-6 py-3 font-medium text-base rounded-xl transition-colors active:scale-[0.99] flex items-center justify-center gap-2 ${file
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
                  Lenken er passordbeskyttet. Husk å dele passordet separat.
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

