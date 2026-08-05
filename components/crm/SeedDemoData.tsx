'use client';

import { useState } from 'react';
import { getAccessToken } from '@privy-io/react-auth';
import { Sparkles, Check } from 'lucide-react';
import { DEMO_SUMMARY } from '@/lib/workspace/demo';
import Button from '@/components/ui/Button';
import { ThinkingLine } from '@/components/ui/Thinking';

/**
 * "Fill this with sample data" — shown only on a workspace that has none.
 *
 * A fresh install lands on an empty pipeline beside an empty ledger beside an
 * empty inbox, which demonstrates nothing about a product whose entire pitch is
 * that those three are the same database. Twenty minutes of typing stands
 * between someone and understanding it, and nobody spends that before deciding
 * whether to care.
 *
 * It disappears the moment there is real data, and the server refuses anyway —
 * sample data mixed into real data is indistinguishable from it a week later,
 * and that is a worse problem than an empty screen.
 */
export default function SeedDemoData({ privy, ws, onSeeded }: {
  privy: string | null; ws: string | null; onSeeded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const seed = async () => {
    if (!privy || !ws) return;
    setBusy(true); setError('');
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/workspace/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({ privyUserId: privy, workspaceId: ws }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error || 'Could not add the sample data.'); return; }
      // Partial success is reported as partial: what landed is real and stays,
      // so "done" would be a lie and silence would hide a gap.
      if (body.failures?.length) setError(`Added most of it. These did not: ${body.failures.slice(0, 3).join('; ')}`);
      setDone(true);
      onSeeded();
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally { setBusy(false); }
  };

  if (done && !error) {
    return (
      <div className="card-surface p-4 flex items-center gap-2.5 text-sm text-secondary">
        <Check className="w-4 h-4 text-success shrink-0" />
        Sample data added — have a look around Sales, Finance and Docs.
      </div>
    );
  }

  return (
    <div className="card-surface p-4">
      {busy ? (
        <ThinkingLine kind="working" label="Adding sample data" hint="Companies, invoices, projects and documents" />
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Sparkles className="w-4 h-4 text-accent shrink-0 hidden sm:block" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-primary">This workspace is empty.</p>
            <p className="text-xs text-secondary mt-0.5">
              Add linked sample data to see how it fits together — {DEMO_SUMMARY}
            </p>
          </div>
          <Button variant="primary" onClick={seed} disabled={!privy || !ws} className="shrink-0 self-start sm:self-auto">
            <Sparkles className="w-3.5 h-3.5" /> Add sample data
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
