'use client';

import { useState } from 'react';
import { Table2, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
import { createApiKey, feedUrl, FEED_OBJECTS } from '@/lib/crm/automations';
import { useDialog } from '@/components/ui/Dialog';

/**
 * "Connect to Excel" — generates a read-only feed key and shows the URL to
 * paste into Excel, Sheets or Power BI.
 *
 * This panel exists because the endpoint alone is a feature only developers
 * find. The three-click instruction is the product; the URL is the plumbing.
 *
 * The key is READ-ONLY and generated here rather than reusing an existing API
 * key, deliberately: this URL ends up in browser history, forwarded emails and
 * screen shares, and the route refuses to write with a key that arrived in a
 * query string at all (0078). Handing someone their existing write key to paste
 * into a spreadsheet would be the wrong default.
 */
export default function ExcelConnect({ privy }: { privy: string | null }) {
  const { notify } = useDialog();
  const [object, setObject] = useState<string>('people');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!privy) return;
    setBusy(true);
    const res = await createApiKey(privy, `Spreadsheet feed (${object})`, 'read');
    setBusy(false);
    if (res.error || !res.key) return notify(res.error || 'Could not create the feed link.');
    setKey(res.key);
  };

  const url = key ? feedUrl(object, key) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { notify('Could not copy — select the URL and copy it manually.'); }
  };

  return (
    <section>
      <h2 className="text-base font-medium text-primary mb-1">Connect to Excel</h2>
      <p className="text-sm text-secondary mb-3">
        A live link to your data that refreshes in place. Works in Excel, Google Sheets and Power BI.
      </p>

      <div className="card-surface p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs text-secondary block mb-1">What to send</span>
            <select
              value={object}
              onChange={(e) => { setObject(e.target.value); setKey(''); }}
              className="input-field !h-9 !text-xs w-56"
            >
              {FEED_OBJECTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          {!key && (
            <button
              onClick={generate}
              disabled={!privy || busy}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Table2 className="w-3.5 h-3.5" />}
              Create link
            </button>
          )}
        </div>

        {!key ? (
          <p className="text-2xs text-tertiary">
            Creates a <strong className="font-medium">read-only</strong> key. It can’t create or change
            anything, and you can revoke it below at any time.
          </p>
        ) : (
          <>
            <div>
              <span className="text-xs text-secondary block mb-1">Your link — copy it now, it’s shown once</span>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="input-field !h-9 flex-1 font-mono !text-2xs"
                />
                <button
                  onClick={copy}
                  className="h-9 px-3 inline-flex items-center rounded-lg bg-surface ring-1 ring-subtle shadow-sm hover:bg-surface-hover"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5 text-secondary" />}
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-surface-sunken p-4 space-y-2">
              <p className="text-xs font-medium text-primary">In Excel</p>
              <ol className="text-xs text-secondary space-y-1 list-decimal list-inside">
                <li><span className="text-primary">Data</span> → <span className="text-primary">Get Data</span> → <span className="text-primary">From Other Sources</span> → <span className="text-primary">From Web</span></li>
                <li>Paste the link, click <span className="text-primary">OK</span>, then <span className="text-primary">Load</span></li>
                <li>For fresh numbers later: <span className="text-primary">Data</span> → <span className="text-primary">Refresh All</span></li>
              </ol>
              <p className="text-xs text-secondary pt-1">
                <span className="text-primary">Google Sheets:</span> put <code className="font-mono text-2xs bg-surface-hover px-1 py-0.5 rounded">=IMPORTDATA(&quot;link&quot;)</code> in a cell.
                {' '}<span className="text-primary">Power BI:</span> Get Data → Web.
              </p>
            </div>

            {/* Said plainly. Anyone with this URL has the data — that is the
                trade for it working in a tool that cannot send headers. */}
            <p className="text-2xs text-warning">
              Treat the link like a password: anyone who has it can read this data. It’s read-only and
              revocable, but don’t post it in a shared channel.
            </p>
          </>
        )}

        <a
          href="https://support.microsoft.com/en-us/office/import-data-from-external-data-sources-power-query-be4330b3-5356-486c-a168-b68e9e616f5a"
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-2xs text-tertiary hover:text-accent"
        >
          Microsoft’s Power Query guide <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </section>
  );
}
