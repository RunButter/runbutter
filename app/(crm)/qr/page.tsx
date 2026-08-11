'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { QrCode, Download, Copy, Check, Loader2, ShieldCheck, AlertTriangle, Upload, X } from 'lucide-react';
import {
  qrSvg, qrPng, qrScans, imageToDataUri, fileToDataUri,
  type EcLevel, type ModuleStyle, type EyeStyle,
} from '@/lib/qr/render';
import { downloadBytes } from '@/lib/pdf/toolkit';
import { getWorkspace, loadBranding } from '@/lib/crm/data';
import PageHeader from '@/components/dashboard/PageHeader';

/**
 * A QR generator, in the tab.
 *
 * It sits beside the PDF tools and follows the same rule: a QR usually encodes
 * a URL, and a URL is often a private one — an unlisted form, a signing link, a
 * record. Sending those to a generator service to get a picture back is a bad
 * trade for something the browser can do in a millisecond. The logo is read the
 * same way: a picked file becomes pixels in this tab and is never uploaded.
 *
 * The logo is offered at all only because `qrScans` checks the result. Punching
 * a mark into the middle destroys modules and leans on error correction to
 * survive it; it usually works, and when it does not it fails at the printer,
 * on a poster, after somebody paid for five hundred of them. A checkbox without
 * a check is how that happens.
 */

const PRESETS: { label: string; hint: string; build: (v: string) => string }[] = [
  { label: 'Link', hint: 'https://…', build: (v) => v.trim() },
  { label: 'Email', hint: 'name@company.com', build: (v) => `mailto:${v.trim()}` },
  { label: 'Phone', hint: '+48 600 000 000', build: (v) => `tel:${v.replace(/[^\d+]/g, '')}` },
  // Wi-Fi is the one people cannot guess the syntax of, and it is the single
  // most common non-URL QR in a shop or an office.
  { label: 'Wi-Fi', hint: 'NetworkName : password', build: (v) => {
    const [ssid, ...rest] = v.split(':');
    const pass = rest.join(':').trim();
    const esc = (s: string) => s.trim().replace(/([\\;,":])/g, '\\$1');
    return `WIFI:T:${pass ? 'WPA' : 'nopass'};S:${esc(ssid || '')};${pass ? `P:${esc(pass)};` : ''};`;
  } },
  { label: 'Text', hint: 'Anything at all', build: (v) => v },
];

const EC_LEVELS: { id: EcLevel; label: string; note: string }[] = [
  { id: 'L', label: 'L', note: '~7% recoverable — smallest code' },
  { id: 'M', label: 'M', note: '~15% — the usual choice' },
  { id: 'Q', label: 'Q', note: '~25%' },
  { id: 'H', label: 'H', note: '~30% — densest, for rough surfaces' },
];

/**
 * Where the mark in the middle comes from.
 *
 * `space` is its own choice rather than an accident of having no picture: some
 * people want the hole and will place their own mark in Illustrator, and that
 * is a decision the UI should be able to show as selected.
 */
type LogoSource = 'off' | 'space' | 'brand' | 'file';

export default function QrPage() {
  const { ready, authenticated, user } = usePrivy();

  const [preset, setPreset] = useState(0);
  const [value, setValue] = useState('');
  const [ec, setEc] = useState<EcLevel>('M');
  const [dark, setDark] = useState('#000000');
  const [moduleStyle, setModuleStyle] = useState<ModuleStyle>('square');
  const [eyeStyle, setEyeStyle] = useState<EyeStyle>('square');
  const [eyeColor, setEyeColor] = useState('');
  const [gradTo, setGradTo] = useState('');

  const [logoSource, setLogoSource] = useState<LogoSource>('off');
  /** Always a data: URI — never a URL. See `logoHref` in the renderer. */
  const [logoHref, setLogoHref] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // null = not checked yet or unknowable. See qrScans.
  const [scans, setScans] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const encoded = PRESETS[preset].build(value);

  // The workspace logo, if there is one. Quietly — a generator that shows an
  // error because branding has not been filled in is worse than one that
  // simply does not offer the option.
  useEffect(() => {
    if (!ready || !authenticated || !user) return;
    let alive = true;
    getWorkspace(user.id)
      .then((w) => (w ? loadBranding(user.id, w.id) : null))
      .then((b) => { if (alive && b?.logo_url) setBrandLogo(b.logo_url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ready, authenticated, user]);

  const useBrandLogo = async () => {
    if (!brandLogo) return;
    setLogoBusy(true); setLogoError('');
    try {
      setLogoHref(await imageToDataUri(brandLogo));
      setLogoSource('brand');
    } catch {
      // Almost always CORS on the image host, which no retry fixes. Say what
      // to do instead of what failed.
      setLogoError('Could not read your branding logo here. Upload the file instead.');
    } finally { setLogoBusy(false); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setLogoBusy(true); setLogoError('');
    try {
      setLogoHref(await fileToDataUri(file));
      setLogoSource('file');
    } catch {
      setLogoError('That file is not an image this browser can read.');
    } finally { setLogoBusy(false); }
  };

  const clearLogo = () => { setLogoSource('off'); setLogoHref(null); setLogoError(''); };

  // Recomputed on every keystroke, which is fine: encoding is sub-millisecond
  // and a live preview is the whole point of a generator.
  const styleOpts = useMemo(() => ({
    ec, dark, moduleStyle, eyeStyle,
    eyeColor: eyeColor || undefined,
    gradient: gradTo ? { from: dark, to: gradTo } : null,
    // The space is cleared whenever a logo is wanted, even while the picture is
    // still loading — so the preview does not jump a module grid around the
    // moment it arrives.
    logoAreaPct: logoSource === 'off' ? 0 : 6,
    logoHref,
  }), [ec, dark, moduleStyle, eyeStyle, eyeColor, gradTo, logoSource, logoHref]);

  const result = useMemo(() => {
    if (!encoded.trim()) return null;
    try { return { ...qrSvg(encoded, styleOpts), error: '' }; }
    catch (e: any) { return { svg: '', modules: 0, clearBox: null, error: e?.message || 'Could not encode that.' }; }
  }, [encoded, styleOpts]);

  /**
   * Check the code we are actually showing, every time it changes.
   *
   * Debounced and cancellable: this rasterises and decodes a megapixel image,
   * and running it on every keystroke would make typing feel heavy. `alive`
   * stops a slow check from overwriting the answer for a newer code — the
   * classic stale-async bug, and here it would tell somebody their working code
   * is broken.
   */
  useEffect(() => {
    if (!result?.svg) { setScans(null); return; }
    let alive = true;
    setScans(null);
    const t = setTimeout(() => {
      qrScans(encoded, styleOpts).then((ok) => { if (alive) setScans(ok); }, () => { if (alive) setScans(null); });
    }, 350);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.svg]);

  const savePng = async () => {
    setBusy(true);
    try { downloadBytes(await qrPng(encoded, 1024, styleOpts), 'qr.png', 'image/png'); }
    finally { setBusy(false); }
  };

  const saveSvg = () => {
    if (!result?.svg) return;
    downloadBytes(new TextEncoder().encode(result.svg), 'qr.svg', 'image/svg+xml');
  };

  const chip = (on: boolean) =>
    `h-7 px-2.5 rounded-md text-2xs font-medium transition-colors ${
      on ? 'bg-inverse text-inverse-fg' : 'text-secondary ring-1 ring-subtle hover:bg-surface-sunken'}`;

  return (
    <>
      <PageHeader title="QR codes" />
      <div className="flex-1 overflow-auto p-5 2xl:p-7 lg:p-6">
        {/* The preview column is wide and sticky because it is the thing being
            made — the controls are how you get there, not the subject. */}
        <div className="max-w-5xl mx-auto grid lg:grid-cols-[minmax(0,1fr)_420px] gap-8 items-start">

          <div className="space-y-6 min-w-0">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p, i) => (
                <button key={p.label} onClick={() => setPreset(i)} className={chip(i === preset)}>{p.label}</button>
              ))}
            </div>

            <label className="block">
              <span className="text-xs text-secondary block mb-1">
                {PRESETS[preset].label}
                {preset === 3 && <span className="text-tertiary"> — network name, then a colon, then the password</span>}
              </span>
              <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={preset === 4 ? 5 : 2}
                className="input-field !h-auto py-2 resize-y text-sm" placeholder={PRESETS[preset].hint} />
            </label>

            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-5">
              <div>
                <span className="text-xs text-secondary block mb-1.5">Modules</span>
                <div className="flex gap-1.5">
                  {(['square', 'rounded', 'dots'] as ModuleStyle[]).map((m) => (
                    <button key={m} onClick={() => setModuleStyle(m)} className={`${chip(moduleStyle === m)} capitalize`}>{m}</button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs text-secondary block mb-1.5">Corners</span>
                <div className="flex gap-1.5">
                  {(['square', 'rounded', 'circle'] as EyeStyle[]).map((m) => (
                    <button key={m} onClick={() => setEyeStyle(m)} className={`${chip(eyeStyle === m)} capitalize`}>{m}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <label className="flex items-center gap-2">
                <input type="color" value={dark} onChange={(e) => setDark(e.target.value)}
                  className="w-8 h-8 rounded-md border border-subtle bg-surface cursor-pointer" />
                <span className="text-xs text-secondary">Colour</span>
              </label>
              {/* Both optional and both off by default. A generator that opens
                  on a gradient makes every code look like a template. */}
              <label className="flex items-center gap-2">
                <input type="color" value={eyeColor || dark} onChange={(e) => setEyeColor(e.target.value)}
                  className="w-8 h-8 rounded-md border border-subtle bg-surface cursor-pointer" />
                <span className="text-xs text-secondary">Corners</span>
                {eyeColor && <button onClick={() => setEyeColor('')} className="text-2xs text-tertiary hover:text-primary underline underline-offset-2">reset</button>}
              </label>
              <label className="flex items-center gap-2">
                <input type="color" value={gradTo || dark} onChange={(e) => setGradTo(e.target.value)}
                  className="w-8 h-8 rounded-md border border-subtle bg-surface cursor-pointer" />
                <span className="text-xs text-secondary">Gradient</span>
                {gradTo && <button onClick={() => setGradTo('')} className="text-2xs text-tertiary hover:text-primary underline underline-offset-2">off</button>}
              </label>
            </div>

            <div>
              <span className="text-xs text-secondary block mb-1.5">Logo</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button onClick={clearLogo} className={chip(logoSource === 'off')}>None</button>
                {brandLogo && (
                  <button onClick={useBrandLogo} disabled={logoBusy} className={`${chip(logoSource === 'brand')} inline-flex items-center gap-1.5 disabled:opacity-50`}>
                    <img src={brandLogo} alt="" className="w-3.5 h-3.5 rounded-sm object-contain" />
                    Our logo
                  </button>
                )}
                <button onClick={() => fileInput.current?.click()} disabled={logoBusy}
                  className={`${chip(logoSource === 'file')} inline-flex items-center gap-1.5 disabled:opacity-50`}>
                  {logoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Upload
                </button>
                <button onClick={() => { setLogoHref(null); setLogoError(''); setLogoSource('space'); }}
                  className={chip(logoSource === 'space')}>Just clear the space</button>
                {logoHref && (
                  <button onClick={clearLogo} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary hover:bg-surface-sunken" title="Remove the logo">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <input ref={fileInput} type="file" accept="image/*" onChange={onFile} className="hidden" />
              <p className="mt-1.5 text-2xs text-tertiary leading-relaxed">
                {logoError
                  ? <span className="text-warning">{logoError}</span>
                  : logoSource === 'off'
                    ? 'A logo clears 6% of the middle. The check on the right confirms the code still reads.'
                    : logoSource === 'space'
                      ? 'Six percent cleared. Drop your mark into the gap in any editor.'
                      : 'The modules underneath are removed, not covered — so the code says exactly what it looks like it says.'}
              </p>
            </div>

            <div>
              <span className="text-xs text-secondary block mb-1.5">Error correction</span>
              <div className="flex gap-1.5">
                {EC_LEVELS.map((l) => (
                  <button key={l.id} onClick={() => setEc(l.id)} title={l.note} className={`${chip(ec === l.id)} !w-9 !px-0`}>{l.label}</button>
                ))}
              </div>
              <p className="mt-1.5 text-2xs text-tertiary leading-relaxed">{EC_LEVELS.find((l) => l.id === ec)!.note}</p>
            </div>

            {/* Said plainly because it is the mistake people make: a pale code
                on white looks stylish on screen and does not scan on paper. */}
            <p className="text-2xs text-tertiary leading-relaxed">
              Dark on light scans best — a pale colour may not scan at all. Everything here happens in this tab,
              so an unlisted link stays unlisted and a logo file is never uploaded.
            </p>
          </div>

          <div className="w-full lg:sticky lg:top-20">
            <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-4">
              {/* Always on white, at any theme. A QR is printed and scanned off
                  paper; showing it on a dark card would preview something
                  nobody will ever hold. The CARD follows the theme, the code
                  does not. */}
              {result?.svg ? (
                <div className="rounded-xl overflow-hidden bg-white p-2 [&>svg]:w-full [&>svg]:h-auto [&>svg]:block"
                  dangerouslySetInnerHTML={{ __html: result.svg }} />
              ) : (
                <div className="aspect-square rounded-xl bg-surface-sunken flex flex-col items-center justify-center gap-2">
                  <QrCode className="w-10 h-10 text-tertiary" />
                  <span className="text-2xs text-tertiary">Type something to see it</span>
                </div>
              )}

              {result?.svg && (
                <div className="mt-3">
                  {scans === null ? (
                    <span className="text-2xs text-tertiary flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking that it scans…
                    </span>
                  ) : scans ? (
                    <span className="text-2xs text-success flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> Checked — a reader gets your text back.
                    </span>
                  ) : (
                    <span className="text-2xs text-warning flex items-start gap-1.5 leading-relaxed">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>
                        A strict reader could not read this one. Phones are more forgiving, but do not print it
                        without testing — try square modules, or raise the error correction.
                      </span>
                    </span>
                  )}
                </div>
              )}

              {result?.error && <p className="mt-3 text-2xs text-danger leading-relaxed">{result.error}</p>}

              {result?.svg && (
                <>
                  <p className="mt-3 text-2xs text-tertiary tabular-nums">
                    {result.modules}×{result.modules} modules · {encoded.length} characters
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <button onClick={savePng} disabled={busy}
                      className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md bg-inverse text-inverse-fg text-2xs font-medium hover:opacity-90 disabled:opacity-50">
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} PNG
                    </button>
                    <button onClick={saveSvg}
                      className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken text-2xs font-medium">
                      <Download className="w-3 h-3" /> SVG
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(result.svg).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }, () => {}); }}
                      className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md ring-1 ring-subtle text-secondary hover:bg-surface-sunken text-2xs font-medium">
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} SVG code
                    </button>
                  </div>
                  <p className="mt-2 text-2xs text-tertiary leading-relaxed">
                    SVG for print and anything that resizes. PNG for Word, social and most print shops.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
