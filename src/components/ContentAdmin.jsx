import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  X, Plus, Pencil, Trash2, ExternalLink, Loader2, ArrowLeft, RotateCcw,
} from 'lucide-react';
import { API_BASE } from '../lib/api';
import ImagePicker from './ImagePicker';

/**
 * Editor for the showcase on the recipient landing page.
 *
 * Behind the same Google sign-in as the rest of the app — any @involve.no
 * address can edit. Deliberately plain: it's used a few times a month by people
 * who don't want to learn a CMS.
 */

// Matches the defaults in server/pages.js. Shown as placeholders so an editor
// can see what they'd get without having to set anything.
const DEFAULTS = {
  pageColor: '#003F46',
  caseColor: '#0B1416',
  ctaColor: '#003F48',
  caseTextColor: '#F8F5EC',
  taglineColor: '#003F46',
  caseOpacity: 0.75,
};

const blankSlide = () => ({
  id: `slide-${Date.now().toString(36)}`,
  enabled: true,
  kicker: '',
  title: '',
  body: '',
  ctaLabel: '',
  ctaUrl: '',
  personName: '',
  personRole: '',
  backgroundUrl: '',
  thumbUrl: '',
  tagline: '',
});

const Field = ({ label, hint, children }) => (
  <div className="mb-4">
    <label className="block text-sand/70 text-sm mb-1.5">{label}</label>
    {children}
    {hint && <p className="text-sand/45 text-xs mt-1.5">{hint}</p>}
  </div>
);

const inputClass = 'field w-full rounded-lg px-3 py-2.5 text-sand text-sm';

const Colour = ({ label, value, fallback, onChange }) => (
  <div className="flex items-center gap-3 mb-2.5">
    <span
      className="w-7 h-7 rounded-md border border-sand/20 shrink-0"
      style={{ background: value || fallback }}
    />
    <span className="flex-1 text-sand/80 text-sm">{label}</span>
    <input
      type="text"
      value={value}
      placeholder={fallback}
      onChange={(event) => onChange(event.target.value)}
      className="field rounded-lg px-2.5 py-1.5 text-sand text-xs w-28 font-mono"
    />
    <button
      type="button"
      onClick={() => onChange('')}
      title="Tilbake til standardfargen"
      className="text-sand/40 hover:text-sand transition-colors p-1"
    >
      <RotateCcw size={14} />
    </button>
  </div>
);

const ContentAdmin = ({ session, onClose }) => {
  const [slides, setSlides] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [editing, setEditing] = useState(null);  // index being edited
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${session.token}` }),
    [session.token]
  );

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/admin/slides`, { headers: authHeaders() })
      .then((response) => {
        if (!response.ok) throw new Error('kunne ikke hente');
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSlides(Array.isArray(data.slides) ? data.slides : []);
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));

    return () => { cancelled = true; };
  }, [authHeaders]);

  /** One write for the whole list — see the note on PUT /admin/slides. */
  const persist = async (next) => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API_BASE}/admin/slides`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ slides: next }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Kunne ikke lagre.');

      setSlides(data.slides);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (saveError) {
      setError(saveError.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const update = (index, changes) =>
    setSlides((current) =>
      current.map((slide, i) => (i === index ? { ...slide, ...changes } : slide))
    );

  const toggle = (index) => {
    const next = slides.map((slide, i) =>
      i === index ? { ...slide, enabled: !slide.enabled } : slide
    );
    setSlides(next);
    persist(next);
  };

  const remove = async (index) => {
    const next = slides.filter((_, i) => i !== index);
    setConfirmDelete(null);
    if (await persist(next)) setEditing(null);
  };

  const liveCount = slides.filter((slide) => slide.enabled !== false).length;

  // --- list ---------------------------------------------------------------

  if (editing === null) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full surface rounded-2xl p-5 md:p-6"
      >
        <div className="flex justify-between items-start mb-5">
          <div>
            <h2 className="text-base font-medium text-sand">Innhold på nedlastingssiden</h2>
            <p className="text-sand/55 text-sm mt-1">
              Mottakere ser én tilfeldig av de påslåtte sidene hver gang de åpner en lenke.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Lukk"
            className="text-sand/60 hover:text-sand hover:bg-sand/5 p-2 rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {state === 'loading' && (
          <p className="text-sand/50 text-sm text-center py-10">Henter innhold…</p>
        )}

        {state === 'error' && (
          <p className="text-rose-400/80 text-sm text-center py-10">
            Kunne ikke hente innholdet. Prøv å laste siden på nytt.
          </p>
        )}

        {state === 'ready' && (
          <>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sand/50 text-xs">
                {liveCount} påslått · {slides.length - liveCount} avslått
              </p>
              <button
                onClick={() => {
                  setSlides((current) => [...current, blankSlide()]);
                  setEditing(slides.length);
                }}
                className="bg-brand text-ink-deep rounded-lg px-3.5 py-2 text-sm font-medium flex items-center gap-1.5"
              >
                <Plus size={15} /> Ny side
              </button>
            </div>

            {slides.length === 0 && (
              <p className="text-sand/50 text-sm text-center py-10">
                Ingen sider ennå. Mottakere får nedlastingskortet på ren bakgrunn.
              </p>
            )}

            <div className="space-y-2">
              {slides.map((slide, index) => (
                <div
                  key={slide.id || index}
                  className={`surface-inset rounded-xl p-3 flex items-center gap-3 ${
                    slide.enabled === false ? 'opacity-45' : ''
                  }`}
                >
                  <div
                    className="w-16 h-16 rounded-lg shrink-0 bg-cover bg-center"
                    style={{
                      backgroundImage: slide.thumbUrl ? `url(${slide.thumbUrl})` : undefined,
                      background: slide.thumbUrl ? undefined : slide.pageColor || DEFAULTS.pageColor,
                    }}
                  />

                  <div className="flex-1 min-w-0">
                    {slide.kicker && (
                      <p className="text-brand text-[11px] tracking-widest uppercase">{slide.kicker}</p>
                    )}
                    <p className="text-sand text-sm font-medium truncate">
                      {slide.title || slide.tagline || 'Uten tittel'}
                    </p>
                    <p className="text-sand/50 text-xs truncate mt-0.5">
                      {slide.body || slide.tagline || 'Ingen tekst'}
                    </p>
                  </div>

                  <button
                    onClick={() => toggle(index)}
                    className={`text-xs px-2.5 py-1.5 rounded-md shrink-0 transition-colors ${
                      slide.enabled === false
                        ? 'bg-sand/10 text-sand/60'
                        : 'bg-mint/20 text-mint'
                    }`}
                  >
                    {slide.enabled === false ? 'Av' : 'På'}
                  </button>

                  <button
                    onClick={() => setEditing(index)}
                    aria-label="Rediger"
                    className="text-sand/60 hover:text-brand p-2 transition-colors"
                  >
                    <Pencil size={15} />
                  </button>

                  <button
                    onClick={() => setConfirmDelete(index)}
                    aria-label="Slett"
                    className="text-sand/50 hover:text-rose-300 p-2 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p className="text-rose-300 text-sm mt-4">{error}</p>}
        {saved && <p className="text-mint text-sm mt-4">Lagret</p>}

        {confirmDelete !== null && (
          <div className="fixed inset-0 bg-ink-deep/75 flex items-center justify-center p-5 z-50">
            <div className="surface bg-ink rounded-2xl p-5 max-w-sm w-full">
              <h3 className="text-sand font-medium mb-2">Slette denne siden?</h3>
              <p className="text-sand/60 text-sm mb-1">
                «{slides[confirmDelete]?.title || slides[confirmDelete]?.tagline || 'Uten tittel'}»
                blir borte for godt. Dette kan ikke angres.
              </p>
              <p className="text-sand/45 text-xs mb-5">
                Vil du bare skjule den for mottakere, kan du slå den av i stedet.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => remove(confirmDelete)}
                  className="bg-rose-500/20 text-rose-200 rounded-lg px-4 py-2.5 text-sm"
                >
                  Ja, slett
                </button>
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="bg-sand/10 text-sand rounded-lg px-4 py-2.5 text-sm"
                >
                  Avbryt
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    );
  }

  // --- editor -------------------------------------------------------------

  const slide = slides[editing];
  if (!slide) {
    setEditing(null);
    return null;
  }

  const set = (changes) => update(editing, changes);
  const isTagline = Boolean(slide.tagline);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full surface rounded-2xl p-5 md:p-6"
    >
      <div className="flex items-center justify-between mb-5">
        <button
          onClick={() => setEditing(null)}
          className="text-sand/60 hover:text-brand text-sm flex items-center gap-2 transition-colors"
        >
          <ArrowLeft size={15} /> Tilbake til oversikten
        </button>

        <label className="flex items-center gap-2 text-sm text-sand/70 cursor-pointer">
          <input
            type="checkbox"
            checked={slide.enabled !== false}
            onChange={(event) => set({ enabled: event.target.checked })}
            className="accent-brand w-4 h-4"
          />
          Vises for mottakere
        </label>
      </div>

      <p className="text-sand/45 text-xs mb-5">
        Fyll ut «Byråtekst» for den gule siden uten case, eller la den stå tom og
        fyll ut feltene under for en vanlig case-side.
      </p>

      <Field
        label="Byråtekst (gul side uten case)"
        hint="Brukes bare på varianten uten case-kort. La stå tom ellers."
      >
        <textarea
          value={slide.tagline || ''}
          onChange={(event) => set({ tagline: event.target.value })}
          rows={2}
          className={inputClass}
        />
      </Field>

      {!isTagline && (
        <>
          <div className="grid md:grid-cols-2 gap-x-4">
            <Field label="Etikett" hint="Den lille teksten over overskriften.">
              <input
                type="text"
                value={slide.kicker || ''}
                onChange={(event) => set({ kicker: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Overskrift">
              <input
                type="text"
                value={slide.title || ''}
                onChange={(event) => set({ title: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Tekst" hint="Rundt 300–400 tegn passer best.">
            <textarea
              value={slide.body || ''}
              onChange={(event) => set({ body: event.target.value })}
              rows={5}
              className={inputClass}
            />
          </Field>

          <div className="grid md:grid-cols-2 gap-x-4">
            <Field label="Knappetekst">
              <input
                type="text"
                value={slide.ctaLabel || ''}
                onChange={(event) => set({ ctaLabel: event.target.value })}
                placeholder="Se caset her"
                className={inputClass}
              />
            </Field>
            <Field label="Lenke" hint="Må begynne med https://">
              <input
                type="url"
                value={slide.ctaUrl || ''}
                onChange={(event) => set({ ctaUrl: event.target.value })}
                placeholder="https://involve.no/…"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="grid md:grid-cols-2 gap-x-4">
            <Field label="Navn">
              <input
                type="text"
                value={slide.personName || ''}
                onChange={(event) => set({ personName: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Tittel">
              <input
                type="text"
                value={slide.personRole || ''}
                onChange={(event) => set({ personRole: event.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </>
      )}

      <div className="border-t border-sand/10 pt-5 mt-2 space-y-5">
        <ImagePicker
          preset="background"
          value={slide.backgroundUrl}
          onChange={(url) => set({ backgroundUrl: url })}
          session={session}
        />
        {!isTagline && (
          <ImagePicker
            preset="thumb"
            value={slide.thumbUrl}
            onChange={(url) => set({ thumbUrl: url })}
            session={session}
          />
        )}
      </div>

      <div className="border-t border-sand/10 pt-5 mt-5">
        <p className="text-sand/55 text-xs uppercase tracking-widest mb-3">Farger</p>

        <Colour
          label="Bakgrunn"
          value={slide.pageColor || ''}
          fallback={DEFAULTS.pageColor}
          onChange={(value) => set({ pageColor: value })}
        />
        {isTagline ? (
          <Colour
            label="Byråtekst"
            value={slide.taglineColor || ''}
            fallback={DEFAULTS.taglineColor}
            onChange={(value) => set({ taglineColor: value })}
          />
        ) : (
          <>
            <Colour
              label="Kort"
              value={slide.caseColor || ''}
              fallback={DEFAULTS.caseColor}
              onChange={(value) => set({ caseColor: value })}
            />
            <Colour
              label="Knapp"
              value={slide.ctaColor || ''}
              fallback={DEFAULTS.ctaColor}
              onChange={(value) => set({ ctaColor: value })}
            />
            <Colour
              label="Tekst i kortet"
              value={slide.caseTextColor || ''}
              fallback={DEFAULTS.caseTextColor}
              onChange={(value) => set({ caseTextColor: value })}
            />

            <div className="mt-4">
              <label className="block text-sand/70 text-sm mb-2">
                Gjennomsiktighet på kortet — {Math.round(
                  (slide.caseOpacity ?? DEFAULTS.caseOpacity) * 100
                )} %
              </label>
              <input
                type="range"
                min="0" max="1" step="0.05"
                value={slide.caseOpacity ?? DEFAULTS.caseOpacity}
                onChange={(event) => set({ caseOpacity: Number(event.target.value) })}
                className="w-full accent-brand"
              />
              <p className="text-sand/45 text-xs mt-1">
                Lavere verdi slipper mer av bakgrunnsbildet gjennom.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-sand/10 pt-5 mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={async () => { if (await persist(slides)) setEditing(null); }}
          disabled={saving}
          className="bg-brand text-ink-deep rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-60 flex items-center gap-2"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          {saving ? 'Lagrer…' : 'Lagre'}
        </button>

        <button
          onClick={() => setEditing(null)}
          className="bg-sand/10 text-sand rounded-lg px-4 py-2.5 text-sm"
        >
          Avbryt
        </button>

        <a
          href={`${API_BASE}/slides/preview/${encodeURIComponent(slide.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sand/60 hover:text-brand text-sm flex items-center gap-1.5 transition-colors"
        >
          <ExternalLink size={15} /> Forhåndsvis
        </a>

        <span className="flex-1" />

        <button
          onClick={() => setConfirmDelete(editing)}
          className="text-rose-300/70 hover:text-rose-300 text-sm flex items-center gap-1.5 transition-colors"
        >
          <Trash2 size={15} /> Slett siden
        </button>
      </div>

      {error && <p className="text-rose-300 text-sm mt-4">{error}</p>}
      {saved && <p className="text-mint text-sm mt-4">Lagret</p>}

      {confirmDelete !== null && (
        <div className="fixed inset-0 bg-ink-deep/75 flex items-center justify-center p-5 z-50">
          <div className="surface bg-ink rounded-2xl p-5 max-w-sm w-full">
            <h3 className="text-sand font-medium mb-2">Slette denne siden?</h3>
            <p className="text-sand/60 text-sm mb-5">
              Den blir borte for godt. Vil du bare skjule den, kan du slå den av i stedet.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => remove(confirmDelete)}
                className="bg-rose-500/20 text-rose-200 rounded-lg px-4 py-2.5 text-sm"
              >
                Ja, slett
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="bg-sand/10 text-sand rounded-lg px-4 py-2.5 text-sm"
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default ContentAdmin;
