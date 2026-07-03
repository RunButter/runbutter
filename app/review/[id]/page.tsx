'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, Lock, MessageCircle } from 'lucide-react';
import { loadPublicPost, addPublicPostComment, type PostDetail } from '@/lib/crm/data';
import { mockPostDetail } from '@/lib/crm/mock';
import PostCanvas from '@/components/marketing/PostCanvas';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-500', in_review: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700', published: 'bg-blue-50 text-blue-700',
};

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
      <ReviewInner />
    </Suspense>
  );
}

function ReviewInner() {
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
      if (res.error) { alert(res.error); return; }
      reload();
    } else {
      setPost((p) => p ? { ...p, comments: [...p.comments, { id: `local-${Date.now()}`, author, body, x, y, resolved: false }] } : p);
    }
  };

  if (blocked) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white rounded-xl ring-1 ring-slate-200 shadow-sm p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3"><Lock className="w-4 h-4 text-slate-400" /></div>
          <h1 className="text-sm font-bold text-slate-800">This review link isn’t valid</h1>
          <p className="mt-1.5 text-[13px] text-slate-500">It may have been replaced — ask the sender for a fresh link.</p>
        </div>
      </div>
    );
  }
  if (!post) return <div className="min-h-screen bg-slate-100 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const open = post.comments.filter((c) => !c.resolved);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-600 to-purple-600" />
          <span className="text-[13px] font-bold text-slate-800">Post review</span>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded capitalize ${STATUS_CHIP[post.status] || STATUS_CHIP.draft}`}>{post.status.replace('_', ' ')}</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[12px] text-slate-400 hidden sm:block">Commenting as</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
              className="h-8 w-36 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-4 sm:p-8 grid lg:grid-cols-[1fr_280px] gap-6 items-start">
        {/* Canvas */}
        <div className="rounded-2xl bg-white/60 ring-1 ring-slate-200/70 p-6 sm:p-10 flex flex-col items-center"
          style={{ backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          <PostCanvas post={post} comments={post.comments} canComment onAddComment={onAddComment} />
          <p className="text-center text-[11px] text-slate-400 mt-4">Click anywhere on the post to pin a comment.</p>
        </div>

        {/* Comments */}
        <aside className="rounded-2xl bg-white ring-1 ring-slate-200/70 p-4">
          <div className="flex items-center gap-1.5 mb-3">
            <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Comments</span>
            <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded px-1.5 tabular-nums">{open.length}</span>
          </div>
          {post.comments.length === 0 && <p className="text-[12px] text-slate-400">No comments yet — click the post to add the first one.</p>}
          <div className="space-y-2.5">
            {post.comments.map((c) => (
              <div key={c.id} className={`rounded-lg ring-1 p-2.5 ${c.resolved ? 'ring-slate-100 bg-slate-50/60 opacity-60' : 'ring-slate-200/70'}`}>
                <div className="text-[12px] font-bold text-slate-700">{c.author}</div>
                <p className={`mt-0.5 text-[12.5px] leading-snug ${c.resolved ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{c.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 text-center">Powered by hirebtr.com</p>
        </aside>
      </div>
    </div>
  );
}
