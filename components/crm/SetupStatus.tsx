'use client';

import { useEffect, useState } from 'react';
import { getAccessToken } from '@privy-io/react-auth';
import { Check, AlertTriangle, Minus, Loader2, ChevronDown } from 'lucide-react';

/**
 * "What is actually configured on this server?"
 *
 * A hosting dashboard answers a different question — it lists variables, not
 * features, and half of them are usually left over from a previous stack. This
 * reads the running process and says which features are on, which are off, and
 * what is broken while they are.
 *
 * Values are never fetched or shown; the endpoint returns booleans.
 */

interface Check {
  key: string; group: string; level: 'required' | 'recommended' | 'feature';
  enables: string; breaks: string; present: boolean; missingAlso: string[];
}

export default function SetupStatus() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [obsolete, setObsolete] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch('/api/health/config', {
          cache: 'no-store',
          headers: token ? { 'x-privy-token': token } : {},
        });
        const body = await res.json();
        if (!res.ok) { setError(body?.error || 'Could not read the configuration.'); return; }
        setChecks(body.checks);
        setObsolete(body.obsolete || []);
      } catch {
        setError('Could not reach the server.');
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="rounded-xl ring-1 ring-subtle bg-surface shadow-card p-5 text-sm text-secondary">{error}</div>
    );
  }
  if (!checks) {
    return (
      <div className="rounded-xl ring-1 ring-subtle bg-surface shadow-card p-5 flex items-center gap-2 text-sm text-secondary">
        <Loader2 className="w-4 h-4 animate-spin" /> Reading the configuration…
      </div>
    );
  }

  const groups = Array.from(new Set(checks.map((c) => c.group)));
  const problems = checks.filter((c) => c.level !== 'feature' && !c.present).length;

  return (
    <div className="rounded-xl ring-1 ring-subtle bg-surface shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-subtle flex items-center gap-3">
        <h2 className="text-sm font-medium text-primary">Setup</h2>
        <span className={`text-2xs px-1.5 py-0.5 rounded-md font-medium ${
          problems ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
          {problems ? `${problems} to look at` : 'Nothing missing'}
        </span>
        <span className="ml-auto text-2xs text-tertiary">Read from this server. No values are shown.</span>
      </div>

      <div className="divide-y divide-subtle">
        {groups.map((g) => (
          <div key={g} className="px-5 py-3.5">
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-2">{g}</div>
            <ul className="space-y-1.5">
              {checks.filter((c) => c.group === g).map((c) => {
                const half = c.present && c.missingAlso.length > 0;
                const isOpen = open[c.key];
                return (
                  <li key={c.key}>
                    <button
                      onClick={() => setOpen((o) => ({ ...o, [c.key]: !o[c.key] }))}
                      className="w-full flex items-start gap-2.5 text-left group"
                    >
                      <span className="mt-0.5 shrink-0">
                        {half ? <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                          : c.present ? <Check className="w-3.5 h-3.5 text-success" />
                          : c.level === 'feature' ? <Minus className="w-3.5 h-3.5 text-tertiary" />
                          : <AlertTriangle className="w-3.5 h-3.5 text-warning" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-xs text-primary">{c.enables}</span>
                        {half && <span className="text-2xs text-warning"> — also needs {c.missingAlso.join(', ')}</span>}
                      </span>
                      <ChevronDown className={`w-3.5 h-3.5 text-tertiary shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="ml-6 mt-1.5 mb-2 text-2xs text-secondary leading-relaxed">
                        <div className="font-mono text-tertiary">{c.key}</div>
                        <p className="mt-1">{c.present ? 'Configured.' : c.breaks}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {obsolete.length > 0 && (
          <div className="px-5 py-3.5">
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-2">Read by nothing</div>
            <p className="text-2xs text-secondary leading-relaxed">
              Set on this server but not used by any code here — safe to delete, and worth deleting so
              the next person does not treat them as load-bearing:{' '}
              <span className="font-mono text-tertiary">{obsolete.join(', ')}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
