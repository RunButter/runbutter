'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// Copyable one-liner for the hero, paperclip.ing-style: a mono command in a
// pill with a click-to-copy affordance.
export default function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  };

  return (
    <button
      onClick={copy}
      className="group inline-flex items-center gap-3 max-w-full h-11 pl-4 pr-2 rounded-xl bg-slate-900 text-slate-100 ring-1 ring-slate-800 font-mono text-[13px] transition hover:ring-slate-700 dark:bg-slate-800 dark:ring-slate-700"
    >
      <span className="text-emerald-400 shrink-0 select-none">$</span>
      <span className="truncate">{command}</span>
      <span className="ml-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-800 text-slate-400 group-hover:text-white transition dark:bg-slate-700">
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </span>
    </button>
  );
}
