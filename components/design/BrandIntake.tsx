'use client';

import { useRef, useState } from 'react';
import { FileText, ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { paletteFromPixels, assignRoles, proposeFromText, type BrandProposal, type RawSwatch } from '@/lib/design/extract';
import { readableOn } from '@/lib/design/color';
import type { DesignTokens, Swatch } from '@/lib/design/tokens';

/**
 * Read a brand out of the files somebody already has.
 *
 * ── NOTHING IS APPLIED WITHOUT A CLICK ──────────────────────────────────────
 * Extraction is right most of the time and openly not always: a logo's most
 * common colour is usually the brand colour and sometimes it is the drop
 * shadow; a "#" in a PDF is usually a swatch and sometimes it is a page
 * reference. So everything found is shown with the context it was found in and
 * a person ticks it — the same shape as /api/workspace/build, and for the same
 * reason. A tool that silently guesses wrong is worse than one that asks.
 *
 * ── IT ALL HAPPENS IN THE TAB ───────────────────────────────────────────────
 * A brand book is usually confidential before a launch and often under NDA.
 * Nothing here uploads: the canvas reads the logo, pdfjs reads the PDF, and
 * both are already installed. Same rule as /pdf, /qr and the plugin builder.
 */

const ROLES = ['accent', 'foreground', 'background', 'surface', 'border', 'muted', 'success', 'warning', 'danger'] as const;

export interface IntakePatch {
  colors?: Swatch[];
  type?: Partial<DesignTokens['type']>;
  radius?: { name: string; px: number }[];
  rules?: { do: string[]; dont: string[] };
}

/**
 * Pixels at natural size, with smoothing OFF.
 *
 * This is the one line that decides whether the extracted hex is the brand's or
 * merely near it. Scaling an image down with smoothing on blends every edge
 * pixel, so a flat #0A2540 logo comes back as a cloud of #0A2540-ish values and
 * the most common one is no longer the brand colour. Capped by area rather than
 * by side so a wide banner is not squashed.
 */
async function pixelsOf(file: File): Promise<Uint8ClampedArray | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = () => rej(new Error('load'));
      i.src = url;
    });
    const natural = (img.width || 1) * (img.height || 1);
    const k = natural > 2_000_000 ? Math.sqrt(2_000_000 / natural) : 1;
    const w = Math.max(1, Math.round((img.width || 1) * k));
    const h = Math.max(1, Math.round((img.height || 1) * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    c.width = 0; c.height = 0;
    return data;
  } catch { return null; }
  finally { URL.revokeObjectURL(url); }
}

export default function BrandIntake({ onLogo, onApply }: {
  onLogo: (r: { name: string; url: string; bytes: Uint8Array } | null) => void;
  onApply: (patch: IntakePatch) => void;
}) {
  const logoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const [swatches, setSwatches] = useState<RawSwatch[]>([]);
  const [role, setRole] = useState<Record<string, string>>({});
  const [logoName, setLogoName] = useState('');

  const [doc, setDoc] = useState<{ name: string; p: BrandProposal } | null>(null);
  const [pickC, setPickC] = useState<Set<string>>(new Set());
  const [pickF, setPickF] = useState<Record<'heading' | 'body' | 'mono', string>>({ heading: '', body: '', mono: '' });
  const [pickR, setPickR] = useState<Set<string>>(new Set());

  const takeLogo = async (f: File | null) => {
    if (!f) return;
    setErr(''); setBusy('logo');
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const url = URL.createObjectURL(new Blob([bytes], { type: f.type || 'image/png' }));
      setLogoName(f.name);
      onLogo({ name: f.name.replace(/[^\w.\-]+/g, '-'), url, bytes });

      // An SVG carries its colours as TEXT, and that is more accurate than any
      // rasterisation: `fill="#0A2540"` is the value the designer typed, while
      // a rendered pixel has been through anti-aliasing and a colour profile.
      let found: RawSwatch[] = [];
      if (/svg/i.test(f.type) || /\.svg$/i.test(f.name)) {
        const text = new TextDecoder().decode(bytes);
        const seen = new Map<string, number>();
        const re = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          const h = m[0].length === 4
            ? `#${m[1][0]}${m[1][0]}${m[1][1]}${m[1][1]}${m[1][2]}${m[1][2]}`.toUpperCase()
            : m[0].toUpperCase();
          seen.set(h, (seen.get(h) || 0) + 1);
        }
        const total = [...seen.values()].reduce((a, b) => a + b, 0) || 1;
        found = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([hex, n]) => ({ hex, share: n / total }));
      }
      if (!found.length) {
        const px = await pixelsOf(f);
        if (!px) { setErr('That image could not be read. PNG, JPG, WebP or SVG.'); return; }
        found = paletteFromPixels(px);
      }
      setSwatches(found);
      const roles = assignRoles(found);
      const next: Record<string, string> = {};
      for (const s of found) {
        next[s.hex] = s.hex === roles.accent ? 'accent'
          : s.hex === roles.background ? 'background'
          : s.hex === roles.foreground ? 'foreground' : '';
      }
      setRole(next);
    } catch { setErr('That image could not be read.'); }
    finally { setBusy(''); }
  };

  const takeDoc = async (f: File | null) => {
    if (!f) return;
    setErr(''); setBusy('doc');
    try {
      let text = '';
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        // Loaded here rather than at module scope: pdfjs is large and most
        // visits to this screen never open a PDF.
        const { pdfToMarkdown } = await import('@/lib/pdf/convert');
        const out = await pdfToMarkdown(await f.arrayBuffer());
        text = out.markdown;
        if (!text.trim()) { setErr('That PDF has no text layer — it is a scan. The values will need typing in; the logo upload still works.'); return; }
      } else {
        text = await f.text();
      }
      const p = proposeFromText(text);
      setDoc({ name: f.name, p });
      setPickC(new Set(p.colors.map((c) => c.value)));
      setPickR(new Set(p.radii.map(String)));
      setPickF({
        heading: p.fonts[0] || '',
        body: p.fonts[1] || p.fonts[0] || '',
        mono: p.fonts.find((x) => /mono|code|courier|consolas|menlo/i.test(x)) || '',
      });
    } catch { setErr('That file could not be read.'); }
    finally { setBusy(''); }
  };

  const applyLogo = () => {
    const colors: Swatch[] = [];
    for (const s of swatches) {
      const r = role[s.hex];
      if (r) colors.push({ name: r, hex: s.hex });
    }
    if (colors.length) onApply({ colors });
  };

  const applyDoc = () => {
    if (!doc) return;
    const patch: IntakePatch = {};
    const colors = doc.p.colors.filter((c) => pickC.has(c.value))
      .map((c) => ({ name: c.context.replace(/[^a-zA-Z0-9 ]+/g, ' ').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24) || 'colour', hex: c.value }));
    if (colors.length) patch.colors = colors;

    const type: Partial<DesignTokens['type']> = {};
    if (pickF.heading) type.heading = pickF.heading;
    if (pickF.body) type.body = pickF.body;
    if (pickF.mono) type.mono = pickF.mono;
    if (Object.keys(type).length) patch.type = type;

    const radii = doc.p.radii.filter((n) => pickR.has(String(n)));
    if (radii.length) patch.radius = radii.map((n, i) => ({ name: ['sm', 'md', 'lg', 'xl'][i] || `r${i}`, px: n }));

    if (doc.p.rules.do.length || doc.p.rules.dont.length) patch.rules = doc.p.rules;
    onApply(patch);
    setDoc(null);
  };

  const toggle = (set: Set<string>, v: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); fn(n);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <button onClick={() => logoRef.current?.click()} disabled={!!busy}
          className="rounded-xl ring-1 ring-subtle bg-surface-sunken hover:bg-surface-hover p-3 text-left disabled:opacity-50">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
            {busy === 'logo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
            Upload your logo
          </span>
          <span className="block text-2xs text-tertiary mt-0.5">
            PNG, JPG, WebP or SVG. The colours come straight out of it — exactly, not approximately.
          </span>
        </button>
        <button onClick={() => docRef.current?.click()} disabled={!!busy}
          className="rounded-xl ring-1 ring-subtle bg-surface-sunken hover:bg-surface-hover p-3 text-left disabled:opacity-50">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
            {busy === 'doc' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            Upload brand guidelines
          </span>
          <span className="block text-2xs text-tertiary mt-0.5">
            A PDF, Markdown or plain text. Hex codes, fonts, sizes and the rules get pulled out.
          </span>
        </button>
      </div>
      <input ref={logoRef} type="file" accept="image/*,.svg" className="hidden"
        onChange={(e) => { takeLogo(e.target.files?.[0] || null); e.currentTarget.value = ''; }} />
      <input ref={docRef} type="file" accept=".pdf,.md,.txt,.markdown,text/*,application/pdf" className="hidden"
        onChange={(e) => { takeDoc(e.target.files?.[0] || null); e.currentTarget.value = ''; }} />

      {err && <p className="text-2xs text-danger">{err}</p>}

      {!!swatches.length && (
        <div className="card-surface p-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-primary flex-1">Colours in {logoName || 'the logo'}</p>
            <button onClick={() => { setSwatches([]); setLogoName(''); onLogo(null); }}
              aria-label="Discard" className="p-1 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-3.5 h-3.5" /></button>
          </div>
          <p className="text-2xs text-tertiary mt-0.5">
            Give each one a job, or leave it blank to ignore it. The share is how much of the image it covers.
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {swatches.map((s) => (
              <div key={s.hex} className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-lg ring-1 ring-subtle shrink-0 grid place-items-center text-3xs font-semibold"
                  style={{ background: s.hex, color: readableOn(s.hex) }}>
                  {Math.round(s.share * 100)}
                </span>
                <code className="text-2xs font-mono text-secondary w-20 shrink-0">{s.hex}</code>
                <select value={role[s.hex] || ''} onChange={(e) => setRole((r) => ({ ...r, [s.hex]: e.target.value }))}
                  aria-label={`Role for ${s.hex}`}
                  className="h-7 px-2 rounded-md bg-surface-sunken ring-1 ring-subtle text-2xs text-primary">
                  <option value="">— ignore —</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button onClick={applyLogo}
            className="mt-2.5 h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
            Use these colours
          </button>
        </div>
      )}

      {doc && (
        <div className="card-surface p-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-primary flex-1">Found in {doc.name}</p>
            <button onClick={() => setDoc(null)} aria-label="Discard"
              className="p-1 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-3.5 h-3.5" /></button>
          </div>

          {doc.p.notes.map((n, i) => (
            <p key={i} className="mt-1.5 text-2xs text-warning">{n}</p>
          ))}

          {!!doc.p.colors.length && (
            <>
              <p className="mt-2.5 text-3xs font-semibold uppercase tracking-wide text-tertiary">Colours</p>
              <div className="mt-1 grid sm:grid-cols-2 gap-1">
                {doc.p.colors.map((c) => (
                  <label key={c.value} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-hover cursor-pointer">
                    <input type="checkbox" checked={pickC.has(c.value)} onChange={() => toggle(pickC, c.value, setPickC)}
                      className="h-3 w-3 accent-[hsl(var(--accent))]" />
                    <span className="w-5 h-5 rounded ring-1 ring-subtle shrink-0" style={{ background: c.value }} />
                    <code className="text-2xs font-mono text-secondary shrink-0">{c.value}</code>
                    <span className="text-3xs text-tertiary truncate">{c.context}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {!!doc.p.fonts.length && (
            <>
              <p className="mt-2.5 text-3xs font-semibold uppercase tracking-wide text-tertiary">Fonts</p>
              <div className="mt-1 grid sm:grid-cols-3 gap-1.5">
                {(['heading', 'body', 'mono'] as const).map((slot) => (
                  <label key={slot} className="block">
                    <span className="text-3xs text-tertiary capitalize">{slot}</span>
                    <select value={pickF[slot]} onChange={(e) => setPickF((f) => ({ ...f, [slot]: e.target.value }))}
                      className="mt-0.5 w-full h-7 px-2 rounded-md bg-surface-sunken ring-1 ring-subtle text-2xs text-primary">
                      <option value="">— none —</option>
                      {doc.p.fonts.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}

          {!!doc.p.radii.length && (
            <>
              <p className="mt-2.5 text-3xs font-semibold uppercase tracking-wide text-tertiary">Corner radius</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {doc.p.radii.map((n) => (
                  <button key={n} onClick={() => toggle(pickR, String(n), setPickR)}
                    className={`h-6 px-2 rounded-md text-2xs font-mono ring-1 ${pickR.has(String(n))
                      ? 'bg-accent/10 ring-accent/40 text-primary' : 'bg-surface-sunken ring-subtle text-tertiary'}`}>
                    {n}px
                  </button>
                ))}
              </div>
            </>
          )}

          {(!!doc.p.rules.do.length || !!doc.p.rules.dont.length) && (
            <>
              <p className="mt-2.5 text-3xs font-semibold uppercase tracking-wide text-tertiary">
                Rules ({doc.p.rules.do.length + doc.p.rules.dont.length})
              </p>
              <p className="text-3xs text-tertiary">Added as written. Edit them afterwards — a sentence lifted from a PDF is rarely the sentence you want.</p>
            </>
          )}

          <button onClick={applyDoc}
            className="mt-2.5 h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
            <Upload className="w-3.5 h-3.5" /> Add what is ticked
          </button>
        </div>
      )}
    </div>
  );
}
