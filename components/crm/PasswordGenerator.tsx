'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Copy, Check, X } from 'lucide-react';
import {
  generatePassword, generatePassphrase, buildAlphabet, entropyBits, passphraseBits,
  strengthLabel, wordListSize, DEFAULT_OPTIONS, type PasswordOptions,
} from '@/lib/vault/password';

/**
 * Its own component because three places need it: the vault, the item editor
 * inside the vault, and the public /password tool. A second copy is how one of
 * them keeps a biased sampler after the other is fixed.
 *
 * The number shown is the REAL entropy of the alphabet and length on screen,
 * not a five-colour strength meter. A meter that calls `Password1!` strong is
 * worse than none, and one that cannot tell 60 bits from 120 is not measuring
 * the thing that decides whether a leaked hash survives.
 */

const TONE = {
  danger: 'text-danger bg-danger/10 ring-danger/30',
  warning: 'text-warning bg-warning/10 ring-warning/30',
  success: 'text-success bg-success/10 ring-success/30',
} as const;

export default function PasswordGenerator({ onClose, onUse, embedded }: {
  onClose?: () => void; onUse?: (pw: string) => void; embedded?: boolean;
}) {
  const [mode, setMode] = useState<'password' | 'passphrase'>('password');
  const [o, setO] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [words, setWords] = useState(5);
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  const roll = useCallback(() => {
    try {
      setErr('');
      setValue(mode === 'password' ? generatePassword(o) : generatePassphrase({ words }));
    } catch (e: any) { setErr(e?.message || 'Could not generate.'); setValue(''); }
  }, [mode, o, words]);

  useEffect(() => { roll(); }, [roll]);

  const bits = mode === 'password'
    ? entropyBits(buildAlphabet(o).length, o.length)
    : passphraseBits(words);
  const s = strengthLabel(bits);

  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* denied */ }
  };

  const body = (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1">
        {(['password', 'passphrase'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`h-7 px-3 rounded-md text-2xs capitalize ${mode === m
              ? 'bg-accent text-accent-fg' : 'text-secondary ring-1 ring-subtle hover:bg-surface-hover'}`}>
            {m}
          </button>
        ))}
      </div>

      <div className="rounded-lg bg-surface-sunken ring-1 ring-subtle p-3">
        <p className="font-mono text-sm text-primary break-all select-all min-h-[1.25rem]">{value}</p>
        {err && <p className="text-2xs text-danger">{err}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button onClick={roll} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-2xs text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            <RefreshCw className="w-3 h-3" /> New
          </button>
          <button onClick={copy} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-2xs text-secondary ring-1 ring-subtle hover:bg-surface-hover">
            {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
          </button>
          <span className={`ml-auto text-2xs font-semibold px-1.5 py-0.5 rounded ring-1 ${TONE[s.tone]}`}>
            {s.label} · {Math.round(bits)} bits
          </span>
        </div>
      </div>

      {mode === 'password' ? (
        <div className="flex flex-col gap-3">
          <label className="block">
            <div className="flex items-baseline justify-between">
              <span className="text-2xs text-secondary">Length</span>
              <span className="text-2xs font-semibold text-primary tabular-nums">{o.length}</span>
            </div>
            <input type="range" min={8} max={64} value={o.length} aria-label="Length"
              onChange={(e) => setO({ ...o, length: Number(e.target.value) })}
              className="mt-1 w-full h-1.5 accent-[hsl(var(--accent))] cursor-pointer" />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <Check2 label="a–z" on={o.lower} set={(v) => setO({ ...o, lower: v })} />
            <Check2 label="A–Z" on={o.upper} set={(v) => setO({ ...o, upper: v })} />
            <Check2 label="0–9" on={o.digits} set={(v) => setO({ ...o, digits: v })} />
            <Check2 label="!#$%…" on={o.symbols} set={(v) => setO({ ...o, symbols: v })} />
          </div>
          <Check2 label="Avoid look-alikes (0 O 1 l I)" on={o.avoidAmbiguous}
            set={(v) => setO({ ...o, avoidAmbiguous: v })} />
        </div>
      ) : (
        <label className="block">
          <div className="flex items-baseline justify-between">
            <span className="text-2xs text-secondary">Words</span>
            <span className="text-2xs font-semibold text-primary tabular-nums">{words}</span>
          </div>
          <input type="range" min={3} max={10} value={words} aria-label="Words"
            onChange={(e) => setWords(Number(e.target.value))}
            className="mt-1 w-full h-1.5 accent-[hsl(var(--accent))] cursor-pointer" />
          <p className="mt-1 text-3xs text-tertiary">
            Drawn from {wordListSize()} words, so each one adds {Math.log2(wordListSize()).toFixed(1)} bits.
            Easy to say down a phone; long enough to be worth saying.
          </p>
        </label>
      )}

      <p className="text-3xs text-tertiary">
        Generated in your browser with the operating system&rsquo;s random source. Nothing is sent anywhere,
        and nothing is stored unless you save it.
      </p>

      {onUse && (
        <button onClick={() => onUse(value)} disabled={!value}
          className="h-9 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
          Use this
        </button>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-surface ring-1 ring-subtle shadow-lg overflow-hidden">
        <div className="h-12 px-4 flex items-center border-b border-subtle">
          <h2 className="text-sm font-medium text-primary">Generate a password</h2>
          <button onClick={onClose} aria-label="Close" className="ml-auto p-1.5 rounded-md text-tertiary hover:bg-surface-hover">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{body}</div>
      </div>
    </div>
  );
}

function Check2({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)}
        className="h-3.5 w-3.5 accent-[hsl(var(--accent))]" />
      <span className="text-2xs text-secondary">{label}</span>
    </label>
  );
}
