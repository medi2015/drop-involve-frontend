
import JSZip from 'jszip'; // <--- ADD THIS
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileCheck, Copy, Loader2, Link as LinkIcon,
  AlertCircle, X, Plus, Mail, MessageSquare, CheckCircle2,
  Clock, Send, User, Key, History as HistoryIcon // <--- Added Key here
} from 'lucide-react';

const API_BASE = 'https://drop-involve-backend.onrender.com';

const UploadCard = () => {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('IDLE'); // IDLE, UPLOADING, SUCCESS, ERROR
  const [transferMode, setTransferMode] = useState('EMAIL'); // EMAIL, LINK
  const [objectKey, setObjectKey] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [requireReceipt, setRequireReceipt] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [emailFrom, setEmailFrom] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [savedContacts, setSavedContacts] = useState([]); // <--- NEW
  const [isOtpSent, setIsOtpSent] = useState(false); // <--- NEW
  const [otp, setOtp] = useState('');                // <--- NEW
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState(7);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // --- HISTORY STATE ---
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('dropInvolveHistory');
    return saved ? JSON.parse(saved) : [];
  });
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    const storedContacts = JSON.parse(localStorage.getItem('dropInvolveContacts') || '[]');
    setSavedContacts(storedContacts);
  }, []);

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

      const zipContent = await zip.generateAsync({ type: 'blob' });
      // Convert the blob into a File object so the rest of your app knows how to handle it
      const zipFile = new File([zipContent], 'Drop_Involve_Filer.zip', { type: 'application/zip' });

      handleFileValidation(zipFile);
    } catch (error) {
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

    // --- NEW SECURITY INTERCEPT ---
    if (transferMode === 'EMAIL') { // <--- OPENS HERE

      if (!emailFrom.toLowerCase().endsWith('@involve.no')) {
        setError('Kun @involve.no-adresser kan sende filer.');
        setStatus('ERROR');
        return;
      }

      if (!isOtpSent) {
        setStatus('UPLOADING');
        try {
          const res = await fetch(`${API_BASE}/request-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailFrom })
          });

          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || 'Kunne ikke sende kode');
          }

          setIsOtpSent(true);
          setStatus('IDLE');
          return; // Stop here and wait for user to type code
        } catch (err) {
          setError(err.message);
          setStatus('ERROR');
          return;
        }
      }

      // Ensure code is typed and verified BEFORE uploading
      if (isOtpSent) {
        if (!otp) {
          setError('Vennligst skriv inn den 6-sifrede koden du fikk på e-post.');
          setStatus('ERROR');
          return;
        }

        // Verify the code with the server
        setStatus('UPLOADING'); // Show spinner while checking
        try {
          const verifyRes = await fetch(`${API_BASE}/verify-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emailFrom, otp })
          });

          if (!verifyRes.ok) {
            throw new Error('Feil kode. Prøv igjen.');
          }
        } catch (err) {
          setError(err.message);
          setStatus('ERROR');
          return; // STOPS the upload process completely
        }
      }

    } // <--- CLOSES HERE (Moved from the top)
    // --- END SECURITY INTERCEPT ---

    // ... rest of upload logic (generate URL, etc.)

    setStatus('UPLOADING');
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      // ... the rest of your code stays exactly the same
      // FIXED: Changed "response" to "res", added "{", and used "fileToUpload"
      const res = await fetch('https://drop-involve-backend.onrender.com/generate-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // ADD THIS FALLBACK: || 'application/octet-stream'
          contentType: fileToUpload.type || 'application/octet-stream',
          fileName: fileToUpload.name,
        })
      });

      if (!res.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, objectKey } = await res.json();
      setObjectKey(objectKey);

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileToUpload,
        headers: {
          'Content-Type': fileToUpload.type || 'application/octet-stream',

          // UPDATE THIS LINE BELOW:
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fileToUpload.name)}"`
        },
      });

      if (!uploadRes.ok) throw new Error('Upload failed');

      const expiresInSeconds = expiry * 24 * 60 * 60;
      const downloadRes = await fetch(`${API_BASE}/generate-download-url?objectKey=${objectKey}&expiresIn=${expiresInSeconds}`);
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

      // Add to the top of the list, keep only the 50 most recent
      const updatedHistory = [newTransfer, ...history].slice(0, 50);
      setHistory(updatedHistory);
      localStorage.setItem('dropInvolveHistory', JSON.stringify(updatedHistory));
      // -------------------------

      // --- NEW EMAIL LOGIC ---
      if (transferMode === 'EMAIL' && emailTo && emailFrom) {
        try {
          await fetch(`${API_BASE}/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              emailTo,
              emailFrom,
              message,
              downloadUrl,
              fileName: fileToUpload.name, // <--- ADD THIS HERE
              otp,
              requireReceipt, // <--- ADD THIS LINE
            })
          });
          const newEmails = emailTo.split(/[,;\s]+/).map(e => e.trim()).filter(e => e.includes('@'));
          const updatedContacts = [...new Set([...newEmails, ...savedContacts])].slice(0, 10); // Keeps the 10 most recent

          setSavedContacts(updatedContacts);
          localStorage.setItem('dropInvolveContacts', JSON.stringify(updatedContacts));
        } catch (emailErr) {
          console.error("Email failed to send, but file was uploaded:", emailErr);
          // We don't setStatus('ERROR') here because the file upload actually worked.
        }
      }
      // -----------------------

    } catch (err) {
      console.error(err);
      setError(err.message);
      setStatus('ERROR');
    }
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
    setIsOtpSent(false); // <--- ADD THIS
    setOtp('');          // <--- ADD THIS
  };

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-4xl px-4">
      {/* Transfer Mode Toggle & History Button */}
      {status === 'IDLE' && (
        <div className="flex flex-wrap justify-center items-center gap-4 mb-2">

          {/* Email / Link Toggle */}
          <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
            <button
              onClick={() => setTransferMode('EMAIL')}
              className={`px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${transferMode === 'EMAIL' ? 'bg-brand text-black' : 'text-slate-400 hover:text-white'}`}
            >
              <Send size={16} /> Send e-post
            </button>
            <button
              onClick={() => setTransferMode('LINK')}
              className={`px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${transferMode === 'LINK' ? 'bg-brand text-black' : 'text-slate-400 hover:text-white'}`}
            >
              <LinkIcon size={16} /> Hent lenke
            </button>
          </div>

          {/* NEW: Prominent History Button */}
          {!showHistory && history.length > 0 && (
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-2 px-6 py-2 bg-white/5 border border-white/10 rounded-2xl text-slate-300 hover:text-white hover:bg-white/10 transition-all text-sm font-bold shadow-lg"
            >
              <HistoryIcon size={16} className="text-brand" /> Vis historikk
            </button>
          )}

        </div>
      )}

      <motion.div
        layout
        className={`w-full bg-[#030712] border-2 rounded-[2rem] p-8 md:p-12 flex flex-col items-center justify-center transition-all duration-300 relative overflow-hidden min-h-[450px] ${isDragging ? 'border-brand shadow-[0_0_50px_-12px_rgba(244,254,139,0.3)]' : 'border-white/10'
          }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >

        {/* --- 2. HISTORY PANEL --- */}
        {showHistory && (
          <div className="w-full h-full flex flex-col min-h-[400px] z-10 w-full">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <HistoryIcon className="text-brand" /> Tidligere overføringer
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-slate-400 hover:text-white bg-white/5 p-2 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {history.map((item) => (
                <div key={item.id} className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center justify-between group hover:bg-white/10 transition-colors w-full">
                  <div className="overflow-hidden pr-4 max-w-[60%]">
                    <p className="text-white font-medium truncate text-sm">{item.fileName}</p>
                    <p className="text-slate-500 text-xs mt-1">{item.date}</p>
                  </div>

                  <button
                    onClick={() => handleCopyLink(item.url, item.id)}
                    className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-[#c4d600]/10 text-[#c4d600] rounded-lg hover:bg-[#c4d600] hover:text-black transition-colors font-medium text-sm"
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
              className="flex flex-col md:flex-row items-center gap-12 w-full"
            >
              {/* Drop Zone */}
              <div className="flex-1 w-full">
                <label className="cursor-pointer group flex flex-col items-center border-2 border-dashed border-white/5 rounded-[1.5rem] p-10 hover:bg-white/[0.02] transition-all h-full min-h-[280px] justify-center relative overflow-hidden">
                  <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 transition-all duration-300 overflow-hidden ${file ? 'bg-emerald-500/20 text-emerald-400' : 'bg-brand text-black shadow-[0_0_30px_-10px_rgba(244,254,139,0.5)]'}`}>
                    {file ? (
                      file.type.startsWith('image/') ? (
                        <img src={URL.createObjectURL(file)} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <FileCheck size={36} />
                      )
                    ) : (
                      <Upload size={36} />
                    )}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{file ? 'Fil valgt' : 'Drop dine filer her'}</h3>
                  <p className="text-slate-500 text-xs text-center max-w-[200px] truncate">
                    {file ? file.name : 'eller klikk hvor som helst for å bla gjennom'}
                  </p>
                  <input type="file" multiple className="hidden" onChange={handleFileSelect} />
                </label>
              </div>

              {/* Form Side */}
              <div className="flex-1 w-full space-y-4">
                <AnimatePresence mode="popLayout">
                  {transferMode === 'EMAIL' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-4 overflow-visible"
                    >
                      {/* Send To Field with Autocomplete Dropdown */}
                      <div className="relative z-50">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                        <input
                          type="text"
                          placeholder="Send til (bruk komma for flere)"
                          value={emailTo}
                          onChange={(e) => {
                            setEmailTo(e.target.value);
                            setIsDropdownOpen(true);
                          }}
                          onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)} // Delay allows click to register
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-brand/50 transition-all"
                        />

                        {/* NEW DROPDOWN MENU */}
                        {isDropdownOpen && savedContacts.length > 0 && (
                          <div className="absolute top-full left-0 w-full mt-2 bg-[#111] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
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
                                  className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-brand/20 hover:text-white transition-colors border-b border-white/5 last:border-0"
                                >
                                  {contact}
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                      {/* Send From Field */}
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                        <input
                          type="email"
                          placeholder="Din e-post (Send fra)"
                          value={emailFrom}
                          onChange={(e) => setEmailFrom(e.target.value)}
                          disabled={isOtpSent} // Locks the email field once the code is sent
                          className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-brand/50 transition-all disabled:opacity-50"
                        />
                      </div>

                      {/* NEW OTP FIELD PLACED RIGHT HERE */}
                      {isOtpSent && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="relative mt-2"
                        >
                          <Key className="absolute left-4 top-[calc(50%-10px)] -translate-y-1/2 text-brand" size={18} />
                          <input
                            type="text"
                            placeholder="Skriv inn 6-sifret kode fra e-post"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            maxLength={6}
                            className="w-full bg-brand/10 border border-brand/30 rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-brand transition-all"
                          />
                          <p className="text-xs text-brand/70 mt-2 ml-1">Sjekk innboksen til {emailFrom} for koden.</p>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="relative">
                  <MessageSquare className="absolute left-4 top-4 text-slate-500" size={18} />
                  <textarea
                    placeholder="Din melding"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white min-h-[120px] resize-none focus:outline-none focus:border-brand/50 transition-all"
                  />
                </div>

                {/* NEW RECEIPT OPT-IN CHECKBOX */}
                {transferMode === 'EMAIL' && (
                  <label className="flex items-center gap-3 text-sm text-slate-300 cursor-pointer w-fit hover:text-white transition-colors">
                    <input
                      type="checkbox"
                      checked={requireReceipt}
                      onChange={(e) => setRequireReceipt(e.target.checked)}
                      className="w-4 h-4 accent-[#c4d600] cursor-pointer"
                    />
                    Få varsel på e-post når filen lastes ned
                  </label>
                )}

                <div className="flex items-center gap-4">
                  <div className="flex-1 relative">
                    <Clock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                    <select
                      value={expiry}
                      onChange={(e) => setExpiry(Number(e.target.value))}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white appearance-none focus:outline-none focus:border-brand/50 transition-all cursor-pointer"
                    >
                      <option value={1} className="bg-[#030712]">Utløper om 1 dag</option>
                      <option value={3} className="bg-[#030712]">Utløper om 3 dager</option>
                      <option value={7} className="bg-[#030712]">Utløper om 7 dager</option>
                      <option value={14} className="bg-[#030712]">Utløper om 14 dager</option>
                    </select>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {status === 'ZIPPING' && (
            <motion.div
              key="zipping"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center w-full max-w-md"
            >
              <div className="w-24 h-24 rounded-2xl bg-brand/10 flex items-center justify-center mb-8">
                <Loader2 size={40} className="text-brand animate-spin" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Komprimerer filer...</h3>
              <p className="text-slate-400 mb-8 text-center">Gjør klar en .zip-fil for overføring</p>
            </motion.div>
          )}

          {status === 'UPLOADING' && (
            <motion.div
              key="uploading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center w-full max-w-md"
            >
              <div className="w-24 h-24 rounded-2xl bg-brand/10 flex items-center justify-center mb-8">
                <Loader2 size={40} className="text-brand animate-spin" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Overfører...</h3>
              <p className="text-slate-400 mb-8 truncate w-full text-center">{file?.name}</p>

              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden mb-4">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "70%" }}
                  className="h-full bg-brand shadow-[0_0_20px_rgba(244,254,139,0.4)]"
                />
              </div>
              <p className="text-brand text-sm font-bold uppercase tracking-widest">Behandler</p>
            </motion.div>
          )}

          {status === 'SUCCESS' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center w-full max-w-md"
            >
              <div className="w-24 h-24 rounded-full bg-brand/10 flex items-center justify-center mb-8 text-brand">
                <CheckCircle2 size={48} />
              </div>
              <h3 className="text-3xl font-bold text-white mb-2 text-center">Fullført!</h3>
              <p className="text-slate-400 mb-10 text-center">
                {transferMode === 'EMAIL' ? 'E-post er sendt og filen er klar' : 'Filen din er klar for deling'}
              </p>

              <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 mb-8 flex items-center gap-4">
                <LinkIcon size={24} className="text-brand shrink-0" />
                <p className="text-slate-200 text-base truncate flex-1 font-mono">{downloadUrl}</p>
                <button
                  onClick={copyToClipboard}
                  className="p-3 hover:bg-brand/10 rounded-xl text-brand transition-colors"
                >
                  <Copy size={24} />
                </button>
              </div>

              <button
                onClick={reset}
                className="text-slate-400 hover:text-white transition-colors flex items-center gap-2 font-bold"
              >
                <X size={18} /> Lukk og tilbakestill
              </button>
            </motion.div>
          )}

          {status === 'ERROR' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center p-8"
            >
              <div className="w-20 h-20 rounded-full bg-rose-500/10 flex items-center justify-center mb-6 text-rose-500">
                <AlertCircle size={40} />
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">Noe gikk galt</h3>
              <p className="text-rose-400/80 text-center mb-10">{error || 'Kunne ikke fullføre overføringen.'}</p>

              <button
                onClick={reset}
                className="px-10 py-4 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-bold transition-all"
              >
                Prøv igjen
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {status === 'IDLE' && (
        <button
          onClick={startTransfer}
          disabled={!file}
          className={`px-12 py-5 font-black text-xl rounded-2xl transition-all active:scale-95 flex items-center gap-3 ${file
            ? 'bg-brand text-black hover:bg-[#e1ec7a] shadow-[0_20px_50px_-12px_rgba(244,254,139,0.3)]'
            : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/5'
            }`}
        >
          {transferMode === 'EMAIL' ? <Send size={24} /> : <LinkIcon size={24} />}
          {transferMode === 'EMAIL' ? 'Overfør via e-post' : 'Hent lenke'}
        </button>
      )}
    </div>
  );
};

export default UploadCard;

