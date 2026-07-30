'use client';

import { useRef, useState } from 'react';
import {
  Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Repeat2, BarChart2,
  ThumbsUp, Share2, Globe, BadgeCheck, X as XIcon,
} from 'lucide-react';

export type Platform = 'instagram' | 'facebook' | 'x' | 'linkedin';
export interface PostComment {
  id: string; author: string; body: string;
  x?: number | null; y?: number | null; resolved: boolean; created_at?: string;
}
export interface PostDraft { platform: Platform; handle?: string | null; content: string; image_url?: string | null }

const AVATAR = 'bg-gradient-to-br from-indigo-500 to-fuchsia-500';
const initials = (s: string) => (s || 'B').replace(/^@/, '').split(/[\s._-]/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// ── Pixel-faithful platform cards (ported from PreFeed, restyled to fit) ──────
function Instagram({ p }: { p: PostDraft }) {
  const h = p.handle || '@yourbrand';
  return (
    <div className="w-[360px] bg-white rounded-lg ring-1 ring-slate-200 overflow-hidden text-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className={`w-8 h-8 rounded-full ${AVATAR} text-white text-3xs font-bold flex items-center justify-center`}>{initials(h)}</div>
        <span className="font-semibold text-slate-900">{h.replace(/^@/, '')}</span>
        <MoreHorizontal className="w-4 h-4 text-slate-500 ml-auto" />
      </div>
      {p.image_url
        ? <img src={p.image_url} alt="" className="w-full aspect-square object-cover" />
        : <div className="w-full aspect-square bg-slate-100 flex items-center justify-center text-slate-300 text-xs">No image yet</div>}
      <div className="px-3 pt-2.5 flex items-center gap-3.5">
        <Heart className="w-5 h-5 text-slate-800" /><MessageCircle className="w-5 h-5 text-slate-800" /><Send className="w-5 h-5 text-slate-800" />
        <Bookmark className="w-5 h-5 text-slate-800 ml-auto" />
      </div>
      <div className="px-3 py-2 text-slate-900">
        <span className="font-semibold">{h.replace(/^@/, '')}</span>{' '}
        <span className="whitespace-pre-wrap">{p.content || 'Your caption…'}</span>
      </div>
    </div>
  );
}

function XCard({ p }: { p: PostDraft }) {
  const h = p.handle || '@yourbrand';
  return (
    <div className="w-[420px] bg-white rounded-xl ring-1 ring-slate-200 p-3.5 text-sm">
      <div className="flex gap-2.5">
        <div className={`w-10 h-10 rounded-full ${AVATAR} text-white text-2xs font-bold flex items-center justify-center shrink-0`}>{initials(h)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-900">{h.replace(/^@/, '')}</span>
            <BadgeCheck className="w-3.5 h-3.5 text-sky-500" />
            <span className="text-slate-400">{h} · now</span>
            <MoreHorizontal className="w-4 h-4 text-slate-400 ml-auto" />
          </div>
          <p className="text-slate-900 whitespace-pre-wrap mt-0.5">{p.content || 'Your post…'}</p>
          {p.image_url && <img src={p.image_url} alt="" className="mt-2.5 rounded-2xl ring-1 ring-slate-200 max-h-64 w-full object-cover" />}
          <div className="flex items-center justify-between mt-3 text-slate-400 pr-8">
            <MessageCircle className="w-4 h-4" /><Repeat2 className="w-4 h-4" /><Heart className="w-4 h-4" /><BarChart2 className="w-4 h-4" /><Share2 className="w-4 h-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Facebook({ p }: { p: PostDraft }) {
  const h = p.handle || 'Your Brand';
  return (
    <div className="w-[420px] bg-white rounded-lg ring-1 ring-slate-200 text-sm">
      <div className="flex items-center gap-2.5 px-3.5 py-3">
        <div className={`w-10 h-10 rounded-full ${AVATAR} text-white text-2xs font-bold flex items-center justify-center`}>{initials(h)}</div>
        <div>
          <div className="font-semibold text-slate-900">{h.replace(/^@/, '')}</div>
          <div className="flex items-center gap-1 text-2xs text-slate-400">Just now · <Globe className="w-3 h-3" /></div>
        </div>
        <MoreHorizontal className="w-4 h-4 text-slate-500 ml-auto" />
      </div>
      <p className="px-3.5 pb-3 text-slate-900 whitespace-pre-wrap">{p.content || 'Your post…'}</p>
      {p.image_url && <img src={p.image_url} alt="" className="w-full max-h-72 object-cover" />}
      <div className="flex items-center justify-around px-3.5 py-2 border-t border-slate-100 text-slate-500 text-xs font-medium">
        <span className="flex items-center gap-1.5"><ThumbsUp className="w-4 h-4" /> Like</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Comment</span>
        <span className="flex items-center gap-1.5"><Share2 className="w-4 h-4" /> Share</span>
      </div>
    </div>
  );
}

function LinkedIn({ p }: { p: PostDraft }) {
  const h = p.handle || 'Your Brand';
  return (
    <div className="w-[420px] bg-white rounded-lg ring-1 ring-slate-200 text-sm">
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <div className={`w-11 h-11 rounded-full ${AVATAR} text-white text-2xs font-bold flex items-center justify-center`}>{initials(h)}</div>
        <div>
          <div className="font-semibold text-slate-900">{h.replace(/^@/, '')}</div>
          <div className="text-2xs text-slate-400">1,234 followers · Just now</div>
        </div>
        <MoreHorizontal className="w-4 h-4 text-slate-500 ml-auto" />
      </div>
      <p className="px-3.5 pb-3 text-slate-900 whitespace-pre-wrap">{p.content || 'Your post…'}</p>
      {p.image_url && <img src={p.image_url} alt="" className="w-full max-h-72 object-cover" />}
      <div className="flex items-center justify-around px-3.5 py-2 border-t border-slate-100 text-slate-500 text-xs font-medium">
        <span className="flex items-center gap-1.5"><ThumbsUp className="w-4 h-4" /> Like</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="w-4 h-4" /> Comment</span>
        <span className="flex items-center gap-1.5"><Repeat2 className="w-4 h-4" /> Repost</span>
        <span className="flex items-center gap-1.5"><Send className="w-4 h-4" /> Send</span>
      </div>
    </div>
  );
}

export function PostMockup({ post }: { post: PostDraft }) {
  switch (post.platform) {
    case 'x': return <XCard p={post} />;
    case 'facebook': return <Facebook p={post} />;
    case 'linkedin': return <LinkedIn p={post} />;
    default: return <Instagram p={post} />;
  }
}

// ── Figma-style comment canvas: click the artwork to drop a numbered pin ──────
export default function PostCanvas({ post, comments, canComment, onAddComment }: {
  post: PostDraft;
  comments: PostComment[];
  canComment: boolean;
  onAddComment: (body: string, x: number, y: number) => Promise<void> | void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const pinned = comments.filter((c) => c.x != null && c.y != null && !c.resolved);

  const place = (e: React.MouseEvent) => {
    if (!canComment || !wrapRef.current) return;
    if ((e.target as HTMLElement).closest('[data-pin], [data-popover]')) return; // don't re-place when clicking pins/popover
    const r = wrapRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    setPending({ x, y }); setDraft('');
  };

  const submit = async () => {
    if (!pending || !draft.trim()) return;
    setSaving(true);
    await onAddComment(draft.trim(), pending.x, pending.y);
    setSaving(false); setPending(null); setDraft('');
  };

  return (
    <div className="relative inline-block" ref={wrapRef} onClick={place} style={{ cursor: canComment ? 'crosshair' : 'default' }}>
      <PostMockup post={post} />

      {/* existing pins */}
      {pinned.map((c, i) => (
        <div key={c.id} data-pin title={`${c.author}: ${c.body}`}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full rounded-bl-none bg-accent text-accent-fg text-2xs font-bold flex items-center justify-center ring-2 ring-surface shadow-md cursor-default"
          style={{ left: `${c.x}%`, top: `${c.y}%` }}>
          {i + 1}
        </div>
      ))}

      {/* pending pin + input */}
      {pending && (
        <>
          <div data-pin className="absolute z-20 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full rounded-bl-none bg-warning text-warning-fg text-2xs font-bold flex items-center justify-center ring-2 ring-surface shadow-md"
            style={{ left: `${pending.x}%`, top: `${pending.y}%` }}>+</div>
          <div data-popover className="absolute z-30 w-64 bg-surface rounded-lg border border-subtle shadow-popover p-2.5"
            style={{ left: `min(max(${pending.x}%, 10%), 65%)`, top: `calc(${pending.y}% + 18px)` }}
            onClick={(e) => e.stopPropagation()}>
            <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Leave a comment…"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              className="w-full px-2 py-1.5 text-xs rounded-md bg-surface text-primary placeholder:text-tertiary border border-subtle focus:border-accent focus:ring-2 focus:ring-accent/25 outline-none resize-none" />
            <div className="flex items-center justify-end gap-1.5 mt-1.5">
              <button onClick={() => setPending(null)} className="p-1 rounded text-tertiary hover:bg-surface-hover" aria-label="Cancel"><XIcon className="w-3.5 h-3.5" /></button>
              <button onClick={submit} disabled={saving || !draft.trim()}
                className="h-7 px-2.5 rounded-md text-xs font-medium text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">Comment</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
