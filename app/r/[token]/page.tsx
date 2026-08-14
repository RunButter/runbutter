'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download, FileText, Loader2 } from 'lucide-react';

/**
 * A shared data room, for anyone with the link.
 *
 * The file set was frozen when the room was made (0110), so this cannot show a
 * document the sender did not choose — including one uploaded afterwards. Names
 * arrive with the page; a URL is fetched per document, on click, and lives two
 * minutes.
 *
 * NO PRIVY, NO APP CHROME. An investor opening a deck should not be asked to
 * sign in to anything, and '/r/' is in the public prefix list so the auth SDK
 * never mounts.
 */
interface RoomFile { id: string; name: string; size: number | null; mime: string | null }
interface Room {
  title: string; note: string; created_at: string; files: RoomFile[];
  brand?: { name?: string; logo_url?: string | null } | null;
}

const fmtSize = (n: number | null) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DataRoomPage() {
  const token = String(useParams().token || '');
  const [room, setRoom] = useState<Room | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'gone'>('loading');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rooms/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (cancelled) return; if (j) { setRoom(j); setState('ok'); } else setState('gone'); })
      .catch(() => { if (!cancelled) setState('gone'); });
    return () => { cancelled = true; };
  }, [token]);

  async function download(f: RoomFile) {
    setBusy(f.id);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(token)}/file/${encodeURIComponent(f.id)}`);
      const j = await res.json().catch(() => null);
      if (j?.url) window.location.href = j.url;
    } finally {
      setBusy(null);
    }
  }

  if (state === 'loading') {
    return <main className="min-h-screen bg-canvas flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-tertiary" />
    </main>;
  }

  // One message for missing, revoked and expired.
  if (state === 'gone' || !room) {
    return <main className="min-h-screen bg-canvas flex items-center justify-center px-6">
      <div className="text-center">
        <h1 className="text-md font-medium text-primary">These documents aren’t available</h1>
        <p className="mt-1 text-sm text-secondary">The link may have been revoked or have expired.</p>
      </div>
    </main>;
  }

  const brand = room.brand || {};

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center gap-2.5 mb-6">
          {brand.logo_url
            ? <img src={brand.logo_url} alt="" className="w-6 h-6 rounded object-contain" />
            : <span className="w-6 h-6 rounded bg-surface-sunken" />}
          <span className="text-sm font-medium text-secondary">{brand.name || 'Shared documents'}</span>
        </div>

        <h1 className="text-md font-medium text-primary">{room.title}</h1>
        {room.note && <p className="mt-1 text-sm text-secondary whitespace-pre-wrap">{room.note}</p>}

        <div className="mt-5 card-surface divide-y divide-subtle">
          {room.files.map((f) => (
            <button key={f.id} onClick={() => download(f)} disabled={busy === f.id}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-sunken/60 disabled:opacity-50">
              <FileText className="w-4 h-4 text-tertiary shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-primary truncate">{f.name}</span>
                {f.size ? <span className="block text-2xs text-tertiary tabular-nums">{fmtSize(f.size)}</span> : null}
              </span>
              {busy === f.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary shrink-0" />
                : <Download className="w-3.5 h-3.5 text-tertiary shrink-0" />}
            </button>
          ))}
          {room.files.length === 0 && (
            <p className="px-3 py-6 text-sm text-secondary text-center">No documents in this room.</p>
          )}
        </div>

        <p className="mt-4 text-center text-2xs text-tertiary">
          Shared with <a href="https://runbutter.app" className="text-accent hover:underline">RunButter</a>
        </p>
      </div>
    </main>
  );
}
