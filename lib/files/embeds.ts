'use client';

/**
 * Referring to a private file from inside a document or a message.
 *
 * THE PROBLEM. Images live in the same private bucket as contracts and
 * payroll, so the only way to read one is a short-lived signed URL minted after
 * a workspace-membership check. Writing that URL into a document's markdown
 * would mean the picture works for an hour and is broken forever after — and it
 * would also persist a time-limited read capability into a row that gets copied
 * into exports, agent transcripts and sent documents.
 *
 * THE ANSWER. Store the id. `![alt](rb-file:<uuid>)` survives markdown
 * round-tripping exactly like any other link target, and the URL is minted at
 * render time, per reader, through the existing membership check.
 *
 * WHY A CUSTOM SCHEME RATHER THAN AN ATTRIBUTE. The doc body is markdown, not
 * HTML — `data-*` attributes do not survive serialisation, but a link target
 * does. It is the one place in the syntax that is guaranteed to come back
 * unchanged.
 */

import { fileUrl, uploadFile } from './client';

/** `rb-file:<uuid>` — our marker for "resolve this against the private bucket". */
export const FILE_SCHEME = 'rb-file:';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REF_RE = new RegExp(`${FILE_SCHEME}(${UUID})`, 'gi');

export const fileRef = (id: string) => `${FILE_SCHEME}${id}`;

/** Every file id referenced by a body, de-duplicated. */
export function referencedFileIds(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(REF_RE)) seen.add(m[1].toLowerCase());
  return [...seen];
}

/**
 * A live map from `rb-file:<id>` to a freshly signed URL, and back again.
 *
 * The reverse direction is why this is a class rather than two functions: after
 * the editor has rendered a signed URL, that URL is what comes back out of it
 * on save, and we have to recognise it to write the id again. A URL we did not
 * mint — someone pasting a link to an image on the open web — is left exactly
 * as it is, which is the behaviour you want.
 */
export class EmbedResolver {
  private toUrl = new Map<string, string>();
  private toId = new Map<string, string>();

  constructor(private privy: string | null) {}

  /** Mint URLs for anything in `body` we have not already resolved. */
  async prime(body: string): Promise<void> {
    if (!this.privy) return;
    const missing = referencedFileIds(body).filter((id) => !this.toUrl.has(id));
    // Sequential rather than Promise.all: a doc with 40 images would otherwise
    // open 40 sockets at once and get rate-limited by our own file route.
    for (const id of missing) {
      const { url } = await fileUrl(id, this.privy);
      if (!url) continue;
      this.toUrl.set(id, url);
      this.toId.set(url, id);
    }
  }

  /** `rb-file:<id>` → signed URL, for handing to an editor or an <img>. */
  expand(body: string): string {
    return body.replace(REF_RE, (whole, id: string) => this.toUrl.get(id.toLowerCase()) ?? whole);
  }

  /** Signed URL → `rb-file:<id>`, for storing. Unknown URLs pass through. */
  collapse(body: string): string {
    let out = body;
    for (const [url, id] of this.toId) out = out.split(url).join(fileRef(id));
    return out;
  }

  /** Resolve one id on its own — for a chat attachment, which has no body. */
  async urlFor(id: string): Promise<string | null> {
    if (!this.privy) return null;
    const known = this.toUrl.get(id.toLowerCase());
    if (known) return known;
    const { url } = await fileUrl(id, this.privy);
    if (!url) return null;
    this.toUrl.set(id.toLowerCase(), url);
    this.toId.set(url, id.toLowerCase());
    return url;
  }

  /** Remember a URL we already have, so `collapse` can undo it later. */
  remember(id: string, url: string) {
    this.toUrl.set(id.toLowerCase(), url);
    this.toId.set(url, id.toLowerCase());
  }
}

/**
 * Upload an image and return both halves: the id to store, and a signed URL to
 * show immediately. Same route, same private bucket, same `files` row as the
 * Files screen — which is the whole point. An image dropped into a channel is
 * already indexed, already listed, and deleting it there removes it here.
 */
export async function uploadEmbed(
  file: File, privy: string, workspaceId: string | null,
  linkedObject?: string | null, linkedId?: string | null,
): Promise<{ id: string; url: string } | { error: string }> {
  const res = await uploadFile(file, privy, workspaceId, linkedObject ?? null, linkedId ?? null);
  if (res.error || !res.id) return { error: res.error || 'Upload failed.' };
  const { url, error } = await fileUrl(res.id, privy);
  if (!url) return { error: error || 'Uploaded, but could not be displayed.' };
  return { id: res.id, url };
}

/** Images only, and small enough that a channel stays readable on a phone. */
export const MAX_EMBED_BYTES = 10 * 1024 * 1024;
export const isImage = (f: File) => f.type.startsWith('image/');
