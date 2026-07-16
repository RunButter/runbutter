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
      className="group inline-flex items-center gap-2.5 max-w-full h-10 pl-3 pr-1.5 rounded-md bg-surface-sunken border border-subtle text-primary font-mono text-sm transition-colors hover:border-strong"
    >
      <span className="text-success shrink-0 select-none">$</span>
      <span className="truncate">{command}</span>
      <span className="ml-1 shrink-0 inline-flex items-center justify-center w-7 h-7 rounded text-tertiary group-hover:text-primary group-hover:bg-surface-hover transition-colors">
        {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
      </span>
    </button>
  );
}
