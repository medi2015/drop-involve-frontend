import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileCheck, Copy, Loader2, Link as LinkIcon,
  AlertCircle, X, Plus, Mail, MessageSquare, CheckCircle2, Clock, Send
} from 'lucide-react';

const API_BASE = 'https://drop-involve-backend.onrender.com';

const UploadCard = () => {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('IDLE'); // IDLE, UPLOADING, SUCCESS, ERROR
  const [transferMode, setTransferMode] = useState('EMAIL'); // EMAIL, LINK
  const [objectKey, setObjectKey] = useState('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [emailTo, setEmailTo] = useState('');
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState(7);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
    }
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const startTransfer = async () => {
    if (!file) return;
    uploadFile(file);
  };

  const uploadFile = async (fileToUpload) => {
    setStatus('UPLOADING');
    setError('');

    try {
      const res = await fetch(`${API_BASE}/generate-upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: fileToUpload.name,
          fileType: fileToUpload.type || 'application/octet-stream',
        }),
      });

      if (!res.ok) throw new Error('Failed to get upload URL');
      const { uploadUrl, objectKey } = await res.json();
      setObjectKey(objectKey);

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: fileToUpload,
        headers: {
          'Content-Type': fileToUpload.type || 'application/octet-stream',
        },
      });

      if (!uploadRes.ok) throw new Error('Upload failed');

      const expiresInSeconds = expiry * 24 * 60 * 60;
      const downloadRes = await fetch(`${API_BASE}/generate-download-url?objectKey=${objectKey}&expiresIn=${expiresInSeconds}`);
      if (!downloadRes.ok) throw new Error('Failed to generate link');
      const { downloadUrl } = await downloadRes.json();

      setDownloadUrl(downloadUrl);
      setStatus('SUCCESS');
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
  };

  return (
    <div className="flex flex-col items-center gap-8 w-full max-w-4xl px-4">
      {/* Transfer Mode Toggle */}
      {status === 'IDLE' && (
        <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10 mb-2">
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
      )}

      <motion.div
        layout
        className={`w-full bg-[#030712] border-2 rounded-[2rem] p-8 md:p-12 flex flex-col items-center justify-center transition-all duration-300 relative overflow-hidden min-h-[450px] ${isDragging ? 'border-brand shadow-[0_0_50px_-12px_rgba(244,254,139,0.3)]' : 'border-white/10'
          }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <AnimatePresence mode="wait">
          {status === 'IDLE' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col md:flex-row items-center gap-12 w-full"
            >
              {/* Drop Zone */}
              <div className="flex-1 w-full">
                <label className="cursor-pointer group flex flex-col items-center border-2 border-dashed border-white/5 rounded-[1.5rem] p-10 hover:bg-white/[0.02] transition-all h-full min-h-[280px] justify-center">
                  <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 transition-all duration-300 ${file ? 'bg-emerald-500/20 text-emerald-400' : 'bg-brand text-black shadow-[0_0_30px_-10px_rgba(244,254,139,0.5)]'}`}>
                    {file ? <FileCheck size={36} /> : <Upload size={36} />}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{file ? 'Fil valgt' : 'Drop dine filer her'}</h3>
                  <p className="text-slate-500 text-xs text-center max-w-[200px]">
                    {file ? file.name : 'eller klikk hvor som helst for å bla gjennom'}
                  </p>
                  <input type="file" className="hidden" onChange={handleFileSelect} />
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
                      className="relative"
                    >
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                      <input
                        type="email"
                        placeholder="Send til (valgfritt)"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-brand/50 transition-all"
                      />
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
                    </select>
                  </div>
                </div>
              </div>
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
                {transferMode === 'EMAIL' ? 'E-post er sendt (simulert) og filen er klar' : 'Filen din er klar for deling'}
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

