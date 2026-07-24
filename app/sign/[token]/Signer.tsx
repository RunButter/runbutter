'use client';

import { useEffect, useRef, useState } from 'react';
import SignaturePad from 'signature_pad';
import { PenLine, Type, Loader2, Check, RotateCcw, FileText } from 'lucide-react';

// Client half of signing: preview the PDF, capture a signature (drawn via
// signature_pad, MIT — or typed), and submit. The token is the only credential.
export default function Signer({ token, title, signerName, docUrl }: {
  token: string; title: string; signerName: string; docUrl: string | null;
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typed, setTyped] = useState(signerName || '');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);

  // Init the signature pad, and keep the backing store crisp on resize/DPR.
  useEffect(() => {
    if (mode !== 'draw' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.getContext('2d')?.scale(ratio, ratio);
      padRef.current?.clear();
    };
    padRef.current = new SignaturePad(canvas, { penColor: '#111111', backgroundColor: 'rgba(255,255,255,0)' });
    resize();
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); padRef.current?.off(); padRef.current = null; };
  }, [mode]);

  const clear = () => padRef.current?.clear();

  const submit = async () => {
    setErr('');
    let type: 'drawn' | 'typed'; let data: string;
    if (mode === 'draw') {
      if (!padRef.current || padRef.current.isEmpty()) { setErr('Draw your signature first.'); return; }
      type = 'drawn'; data = padRef.current.toDataURL('image/png');
    } else {
      if (!typed.trim()) { setErr('Type your name to sign.'); return; }
      type = 'typed'; data = typed.trim();
    }
    setBusy(true);
    try {
      const res = await fetch('/api/sign/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, type, data }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setErr(j?.error || 'Could not submit your signature.'); return; }
      setDone(true);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-success/10 text-success mx-auto flex items-center justify-center mb-4"><Check className="w-6 h-6" /></div>
          <h1 className="text-lg font-medium text-primary">Signed — thank you</h1>
          <p className="mt-2 text-[13px] text-secondary leading-relaxed">Your signature on <b>{title}</b> is recorded. Once everyone has signed, the completed PDF is emailed to you.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 grid md:grid-cols-[1fr_380px] min-h-0">
      {/* Document preview */}
      <div className="bg-surface-sunken min-h-[40vh] md:min-h-0">
        {docUrl ? (
          <object data={docUrl} type="application/pdf" className="w-full h-full min-h-[50vh]">
            <div className="p-8 text-center text-[13px] text-secondary">
              <FileText className="w-8 h-8 mx-auto mb-2 text-tertiary" />
              Can’t preview here — <a href={docUrl} target="_blank" rel="noreferrer" className="text-accent underline">open the PDF</a>.
            </div>
          </object>
        ) : (
          <div className="p-8 text-center text-tertiary text-[13px]">Document preview unavailable.</div>
        )}
      </div>

      {/* Signing panel */}
      <div className="border-l border-subtle p-6 flex flex-col gap-4 overflow-auto">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-tertiary">Signature requested</div>
          <h1 className="mt-1 text-lg font-medium text-primary tracking-tight">{title}</h1>
          <p className="text-[13px] text-secondary">Signing as <span className="font-medium text-primary">{signerName}</span></p>
        </div>

        <div className="flex gap-1 p-1 rounded-lg bg-surface-sunken">
          <button onClick={() => setMode('draw')} className={`flex-1 h-8 rounded-md text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 ${mode === 'draw' ? 'bg-surface text-primary shadow-sm' : 'text-tertiary'}`}><PenLine className="w-3.5 h-3.5" /> Draw</button>
          <button onClick={() => setMode('type')} className={`flex-1 h-8 rounded-md text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 ${mode === 'type' ? 'bg-surface text-primary shadow-sm' : 'text-tertiary'}`}><Type className="w-3.5 h-3.5" /> Type</button>
        </div>

        {/* PAPER EXCEPTION — the white/gray literals below are deliberate, not
            missed tokens. The pen draws #111111 ink and the captured PNG is
            stamped onto a white PDF page, so this pad depicts paper. Tokenizing
            it would turn the pad dark in dark mode and the signature would be
            invisible both here and on the finished document. */}
        {mode === 'draw' ? (
          <div>
            <div className="relative rounded-lg border border-subtle bg-white h-40">
              <canvas ref={canvasRef} className="w-full h-full touch-none" />
              <button onClick={clear} className="absolute top-1.5 right-1.5 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"><RotateCcw className="w-3.5 h-3.5" /></button>
            </div>
            <p className="mt-1 text-[11px] text-tertiary">Draw with a mouse or finger.</p>
          </div>
        ) : (
          <div>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name"
              className="w-full h-11 px-3 rounded-lg bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none text-lg" />
            {typed && <div className="mt-2 rounded-lg border border-subtle bg-white px-3 py-3 text-2xl text-gray-900" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{typed}</div>}
          </div>
        )}

        <label className="flex items-start gap-2 text-[12px] text-secondary">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 rounded border-subtle accent-accent" />
          I agree that my electronic signature is the legal equivalent of my handwritten signature on this document.
        </label>

        {err && <div className="rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-[12px] text-danger">{err}</div>}

        <button onClick={submit} disabled={busy || !agreed}
          className="h-11 rounded-lg bg-inverse text-inverse-fg text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-40">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Sign document
        </button>
        <p className="text-[11px] text-tertiary text-center">Signed with RunButter · your IP and time are recorded for the audit trail.</p>
      </div>
    </div>
  );
}
