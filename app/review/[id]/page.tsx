'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, Lock, MessageCircle } from 'lucide-react';
import { loadPublicPost, addPublicPostComment, type PostDetail } from '@/lib/crm/data';
import { mockPostDetail } from '@/lib/crm/mock';
import PostCanvas from '@/components/marketing/PostCanvas';
import { useDialog } from '@/components/ui/Dialog';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-surface-hover text-secondary', in_review: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success', published: 'bg-accent/10 text-accent',
};

export default function ReviewPage() {
  const { notify } = useDialog();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
      <ReviewInner />
    </Suspense>
  );
}

function ReviewInner() {
  const { notify } = useDialog();
  const params = useParams();
  const search = useSearchParams();
  const id = String(params.id);
  const token = search.get('t') || '';

  const [post, setPost] = useState<PostDetail | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    try { setName(localStorage.getItem('hb-reviewer-name') || ''); } catch {}
  }, []);

  const reload = useCallback(() => {
    if (!isUuid(id)) { setPost({ ...(mockPostDetail(id) as any), live: false }); return; } // demo ids
    loadPublicPost(id, token).then((p) => { if (p) setPost(p); else setBlocked(true); });
  }, [id, token]);
  useEffect(() => { reload(); }, [reload]);

  const onAddComment = async (body: string, x: number, y: number) => {
    const author = name.trim() || 'Client';
    try { localStorage.setItem('hb-reviewer-name', author); } catch {}
    if (post?.live) {
      const res = await addPublicPostComment(id, token, author, body, x, y);
      if (res.error) { notify(res.error); return; }
      reload();
    } else {
      setPost((p) => p ? { ...p, comments: [...p.comments, { id: `local-${Date.now()}`, author, body, x, y, resolved: false }] } : p);
    }
  };

  if (blocked) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-surface rounded-xl ring-1 ring-subtle shadow-sm p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-surface-hover flex items-center justify-center mb-3"><Lock className="w-4 h-4 text-tertiary" /></div>
          <h1 className="text-sm font-medium text-primary">This review link isn’t valid</h1>
          <p className="mt-1.5 text-[13px] text-secondary">It may have been replaced — ask the sender for a fresh link.</p>
        </div>
      </div>
    );
  }
  if (!post) return <div className="min-h-screen bg-surface-hover flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const open = post.comments.filter((c) => !c.resolved);

  return (
    <div className="min-h-screen bg-surface-hover text-primary">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-surface/$1 backdrop-blur border-b border-subtle">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-600 to-purple-600" />
          <span className="text-[13px] font-medium text-primary">Post review</span>
          <span className={`text-[10px] font-medium uppercase tracking-widest px-1.5 py-0.5 rounded capitalize ${STATUS_CHIP[post.status] || STATUS_CHIP.draft}`}>{post.status.replace('_', ' ')}</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[12px] text-tertiary hidden sm:block">Commenting as</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
              className="h-8 w-36 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle focus:ring-2 focus:ring-accent/30 outline-none" />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 sm:p-8 grid lg:grid-cols-[1fr_280px] gap-6 items-start">
        {/* Canvas */}
        <div className="rounded-2xl bg-surface/$1 ring-1 ring-subtle p-6 sm:p-10 flex flex-col items-center"
          style={{ backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          <PostCanvas post={post} comments={post.comments} canComment onAddComment={onAddComment} />
          <p className="text-center text-[11px] text-tertiary mt-4">Click anywhere on the post to pin a comment.</p>
        </div>

        {/* Comments */}
        <aside className="rounded-2xl bg-surface ring-1 ring-subtle p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <MessageCircle className="w-3.5 h-3.5 text-tertiary" />
            <span className="text-[11px] font-medium uppercase tracking-widest text-tertiary">Comments</span>
            <span className="text-[11px] font-semibold text-tertiary bg-surface-hover rounded px-1.5 tabular-nums">{open.length}</span>
          </div>
          {post.comments.length === 0 && <p className="text-[12px] text-tertiary">No comments yet — click the post to add the first one.</p>}
          <div className="space-y-2.5">
            {post.comments.map((c) => (
              <div key={c.id} className={`rounded-lg ring-1 p-2.5 ${c.resolved ? 'ring-subtle bg-surface-sunken opacity-60' : 'ring-subtle'}`}>
                <div className="text-[12px] font-medium text-secondary">{c.author}</div>
                <p className={`mt-0.5 text-[12.5px] leading-snug ${c.resolved ? 'text-tertiary line-through' : 'text-secondary'}`}>{c.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 pt-3 border-t border-subtle text-[10px] text-tertiary text-center">Powered by runbutter.app</p>
        </aside>
      </div>
    </div>
  );
}
