'use client';

/**
 * Attachments on a chat message.
 *
 * An attachment is a `files.id` and nothing more (0081). Rendering one means
 * minting a short-lived signed URL through the same membership-checked route
 * the Files screen uses — which is why the URL is fetched here, per reader, per
 * view, rather than being stored anywhere.
 *
 * Images render inline because that is the whole point of the feature. Anything
 * else renders as a chip: a PDF stretched to 400px tall is not a preview, it is
 * a wall between two messages.
 */

import { useEffect, useState } from 'react';
import { FileText, Download, ImageOff } from 'lucide-react';
import type { Attachment } from '@/lib/crm/chat';
import type { EmbedResolver } from '@/lib/files/embeds';
import { formatBytes } from '@/lib/files/client';

const isImage = (mime: string) => mime.startsWith('image/');

function AttachmentTile({ att, embeds }: { att: Attachment; embeds: EmbedResolver }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    embeds.urlFor(att.file_id).then((u) => {
      if (!alive) return;
      if (u) setUrl(u); else setFailed(true);
    });
    return () => { alive = false; };
  }, [att.file_id, embeds]);

  // Deleted from the Files screen, or no longer readable. Say so plainly — a
  // silently missing image reads as a bug in chat.
  if (failed) {
    return (
      <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md bg-surface-sunken text-2xs text-tertiary">
        <ImageOff className="w-3.5 h-3.5" /> {att.name} — no longer available
      </span>
    );
  }

  if (isImage(att.mime)) {
    return (
      <a href={url ?? undefined} target="_blank" rel="noreferrer"
         className="block max-w-xs rounded-lg overflow-hidden ring-1 ring-subtle bg-surface-sunken">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived, off-origin
          <img src={url} alt={att.name} className="block w-full h-auto max-h-72 object-contain"
               onError={() => setFailed(true)} />
        ) : (
          // Reserve the space before the URL arrives so the conversation does
          // not jump under whoever is reading it.
          <span className="block h-32 w-48" />
        )}
      </a>
    );
  }

  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" download={att.name}
       className="inline-flex items-center gap-2 h-8 px-2.5 rounded-md ring-1 ring-subtle bg-surface hover:bg-surface-sunken text-xs text-secondary">
      <FileText className="w-3.5 h-3.5 text-tertiary shrink-0" />
      <span className="truncate max-w-[14rem]">{att.name}</span>
      <span className="text-2xs text-tertiary tabular-nums shrink-0">{formatBytes(att.size)}</span>
      <Download className="w-3.5 h-3.5 text-tertiary shrink-0" />
    </a>
  );
}

export default function ChatAttachments({ items, embeds }: { items?: Attachment[]; embeds: EmbedResolver }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {items.map((a) => <AttachmentTile key={a.file_id} att={a} embeds={embeds} />)}
    </div>
  );
}
