import { useState, useRef, useEffect, useCallback } from 'react';
import { Trash2, Crop as CropIcon, Loader2 } from 'lucide-react';
import { API_BASE } from '../lib/api';
import {
  PRESETS, loadImage, releaseImage, coverScale, clampOffset, cropToFile, formatKb,
} from '../lib/images';

/**
 * Pick an image, crop it, upload it.
 *
 * Cropping exists because the two slots have fixed shapes — 16:9 behind the
 * page, square in the card — and CSS centre-cropping an arbitrary photo tends
 * to remove the person's head. Better to let whoever chose the photo decide
 * what survives.
 */
const FRAME_WIDTH = 440;

const ImagePicker = ({ preset, field, value, onChange, session, registerPending }) => {
  const { aspect, label } = PRESETS[preset];
  const frameHeight = Math.round(FRAME_WIDTH / aspect);

  const [image, setImage] = useState(null);     // the chosen file, pre-crop
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [size, setSize] = useState(null);

  const dragging = useRef(null);
  const inputRef = useRef(null);

  const centred = (loaded, level) => {
    const scale = coverScale(loaded, FRAME_WIDTH, frameHeight) * level;
    return clampOffset(
      {
        x: (FRAME_WIDTH - loaded.naturalWidth * scale) / 2,
        y: (frameHeight - loaded.naturalHeight * scale) / 2,
      },
      loaded, FRAME_WIDTH, frameHeight, level
    );
  };

  const choose = async (file) => {
    if (!file) return;
    setError('');

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError('Bruk JPG, PNG eller WebP.');
      return;
    }

    try {
      const loaded = await loadImage(file);
      setImage(loaded);
      setZoom(1);
      setOffset(centred(loaded, 1));
    } catch {
      setError('Kunne ikke lese bildet.');
    }
  };

  /**
   * Zooms around the middle of the frame rather than the top-left corner, so
   * whatever the person has lined up stays where they put it.
   */
  const changeZoom = (next) => {
    if (!image) return;

    const base = coverScale(image, FRAME_WIDTH, frameHeight);
    const midX = FRAME_WIDTH / 2;
    const midY = frameHeight / 2;

    const pointX = (midX - offset.x) / (base * zoom);
    const pointY = (midY - offset.y) / (base * zoom);

    setZoom(next);
    setOffset(
      clampOffset(
        { x: midX - pointX * base * next, y: midY - pointY * base * next },
        image, FRAME_WIDTH, frameHeight, next
      )
    );
  };

  const onPointerDown = (event) => {
    dragging.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = useCallback((event) => {
    if (!dragging.current || !image) return;
    const height = Math.round(FRAME_WIDTH / aspect);
    setOffset(
      clampOffset(
        { x: event.clientX - dragging.current.x, y: event.clientY - dragging.current.y },
        image, FRAME_WIDTH, height, zoom
      )
    );
  }, [image, zoom, aspect]);

  const onPointerUp = () => { dragging.current = null; };

  const discard = () => {
    releaseImage(image);
    setImage(null);
    registerPending?.(field, null);
  };

  /**
   * Returns the uploaded URL as well as reporting it, so the editor can save
   * a slide in the same pass without waiting for React state to settle.
   */
  const upload = async () => {
    setBusy(true);
    setError('');

    try {
      const blob = await cropToFile(image, {
        frameW: FRAME_WIDTH, frameH: frameHeight, zoom, offset, preset,
      });

      const response = await fetch(`${API_BASE}/admin/slides/media`, {
        method: 'POST',
        headers: {
          'Content-Type': blob.type,
          Authorization: `Bearer ${session.token}`,
        },
        body: blob,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Opplastingen feilet.');

      setSize(blob.size);
      onChange(data.url);
      discard();
      return data.url;
    } catch (uploadError) {
      setError(uploadError.message);
      throw uploadError;
    } finally {
      setBusy(false);
    }
  };

  // Tells the editor there's a crop waiting, so pressing Lagre finishes it
  // rather than silently throwing it away. Re-registered every render so the
  // function it holds always closes over the current crop position.
  useEffect(() => {
    if (!image) return undefined;
    registerPending?.(field, upload);
    return () => registerPending?.(field, null);
  });

  return (
    <div>
      <p className="text-sand/70 text-sm mb-2">{label}</p>

      {/* Already uploaded, nothing being cropped */}
      {value && !image && (
        <div className="surface-inset rounded-xl p-3 flex items-center gap-3">
          <img
            src={value}
            alt=""
            className="w-24 rounded-lg object-cover shrink-0"
            style={{ aspectRatio: String(aspect) }}
          />
          <div className="flex-1 min-w-0 text-sm">
            <p className="text-sand">Bilde lagt inn</p>
            {size && <p className="text-sand/50 text-xs mt-0.5">{formatKb(size)} etter komprimering</p>}
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-sand/60 hover:text-brand transition-colors text-sm flex items-center gap-1.5"
          >
            <CropIcon size={15} /> Bytt
          </button>
          <button
            type="button"
            onClick={() => { onChange(''); setSize(null); }}
            aria-label="Fjern bildet"
            className="text-sand/50 hover:text-rose-300 transition-colors p-2"
          >
            <Trash2 size={15} />
          </button>
        </div>
      )}

      {/* Nothing chosen yet */}
      {!value && !image && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="dropzone w-full rounded-xl py-7 px-4 text-center"
        >
          <span className="block text-sand text-sm">Klikk for å velge et bilde</span>
          <span className="block text-sand/45 text-xs mt-1">
            JPG, PNG eller WebP · beskjæres til {preset === 'background' ? '16:9' : 'kvadratisk'}
          </span>
        </button>
      )}

      {/* Cropping */}
      {image && (
        <div className="surface-inset rounded-xl p-3">
          <div
            className="relative overflow-hidden rounded-lg bg-ink-deep mx-auto touch-none cursor-grab active:cursor-grabbing"
            style={{ width: FRAME_WIDTH, height: frameHeight, maxWidth: '100%' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <img
              src={image.src}
              alt=""
              draggable="false"
              className="absolute origin-top-left max-w-none select-none"
              style={{
                width: image.naturalWidth * coverScale(image, FRAME_WIDTH, frameHeight) * zoom,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          </div>

          <label className="flex items-center gap-3 mt-3 text-sm text-sand/60">
            Zoom
            <input
              type="range"
              min="1" max="3" step="0.01"
              value={zoom}
              onChange={(event) => changeZoom(Number(event.target.value))}
              className="flex-1 accent-brand"
            />
          </label>

          <p className="text-sand/45 text-xs mt-1">Dra bildet for å velge utsnittet.</p>

          <p className="text-brand/90 text-xs mt-2">
            Bildet er ikke lastet opp ennå. Trykk «Last opp bildet» — eller bare
            Lagre, så gjøres det for deg.
          </p>

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => upload().catch(() => {})}
              disabled={busy}
              className="bg-brand text-ink-deep rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-60 flex items-center gap-2"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {busy ? 'Laster opp…' : 'Last opp bildet'}
            </button>
            <button
              type="button"
              onClick={discard}
              className="bg-sand/10 text-sand rounded-lg px-4 py-2.5 text-sm"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-rose-300 text-sm mt-2">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
};

export default ImagePicker;
