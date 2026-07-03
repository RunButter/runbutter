'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Check, Copy, Link2, Loader2, Lock, Upload, MessageCircle, CheckCircle2, Circle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  loadPost, savePost, addPostComment, setPostCommentResolved,
  type PostDetail, type PostPlatform,
} from '@/lib/crm/data';
import PostCanvas from '@/components/marketing/PostCanvas';

const PLATFORMS: PostPlatform[] = ['instagram', 'facebook', 'x', 'linkedin'];
const STATUSES = ['draft', 'in_review', 'approved', 'published'];

export default function PostStudio() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [post, setPost] = useState<PostDetail | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(() => {
    loadPost(privy, id).then((p) => { if (p) setPost(p); else setBlocked(true); });
  }, [privy, id]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const set = (patch: Partial<PostDetail>) => { setPost((p) => (p ? { ...p, ...patch } : p)); setSaved(false); };

  const save = async () => {
    if (!privy || !post) return;
    setSaving(true);
    const res = await savePost(privy, post.live ? id : null, {
      platform: post.platform, handle: post.handle, content: post.content,
      image_url: post.image_url, status: post.status,
    });
    setSaving(false);
    if (res.error) { alert(res.error); return; }
    setSaved(true);
    if (!post.live && res.id) router.replace(`/marketing/posts/${res.id}`); else reload();
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('branding').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (!error) {
      const { data } = supabase.storage.from('branding').getPublicUrl(path);
      set({ image_url: data.publicUrl });
    } else {
      alert(`Upload failed: ${error.message}. Run migration 0017 (branding bucket) first.`);
    }
    setUploading(false);
  };

  const onAddComment = async (body: string, x: number, y: number) => {
    if (post?.live && privy) {
      const res = await addPostComment(privy, id, body, x, y);
      if (res.error) { alert(res.error); return; }
      reload();
    } else {
      // sample mode: local-only so the flow is demonstrable
      setPost((p) => p ? { ...p, comments: [...p.comments, { id: `local-${Date.now()}`, author: 'You', body, x, y, resolved: false }] } : p);
    }
  };

  const toggleResolved = async (commentId: string, resolved: boolean) => {
    if (post?.live && privy) {
      await setPostCommentResolved(privy, commentId, resolved);
      reload();
    } else {
      setPost((p) => p ? { ...p, comments: p.comments.map((c) => (c.id === commentId ? { ...c, resolved } : c)) } : p);
    }
  };

  const copyReviewLink = async () => {
    if (!post) return;
    const url = `${window.location.origin}/review/${id}?t=${post.share_token || ''}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  // pin numbering must match the canvas (unresolved pinned, in order)
  const pinnedIds = useMemo(() => (post?.comments || []).filter((c) => c.x != null && c.y != null && !c.resolved).map((c) => c.id), [post]);

  if (blocked) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white rounded-xl ring-1 ring-slate-200 shadow-sm p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3"><Lock className="w-4 h-4 text-slate-400" /></div>
          <h1 className="text-sm font-bold text-slate-800">This post isn’t available</h1>
          <p className="mt-1.5 text-[13px] text-slate-500">Open it from your workspace, or sign in first.</p>
        </div>
      </div>
    );
  }
  if (!post) return <div className="flex-1 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-slate-200/70">
        <button onClick={() => router.push('/marketing/posts')} className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 hover:bg-slate-100"><ArrowLeft className="w-3.5 h-3.5" /> Posts</button>
        <h1 className="text-sm font-bold text-slate-800">Post studio</h1>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${post.live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{post.live ? 'Live' : 'Sample'}</span>
        <div className="ml-auto flex items-center gap-2">
          <select value={post.status} onChange={(e) => set({ status: e.target.value })}
            className="h-7 px-2 text-[12px] font-semibold rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500 capitalize">
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button onClick={copyReviewLink}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Link2 className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Review link'}
          </button>
          <button onClick={save} disabled={!privy || saving} title={!privy ? 'Sign in to save' : ''}
            className="h-7 px-3 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null} {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-slate-100/70 p-8 flex items-start justify-center"
          style={{ backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          <div className="my-4">
            <PostCanvas post={post} comments={post.comments} canComment onAddComment={onAddComment} />
            <p className="text-center text-[11px] text-slate-400 mt-4">Click anywhere on the post to leave a pinned comment — like Figma.</p>
          </div>
        </div>

        {/* Sidebar: editor + comments */}
        <aside className="w-80 shrink-0 border-l border-slate-200/70 bg-white overflow-y-auto">
          <div className="p-4 space-y-3 border-b border-slate-200/70">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Post</div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Platform</label>
              <div className="flex gap-1">
                {PLATFORMS.map((pl) => (
                  <button key={pl} onClick={() => set({ platform: pl })}
                    className={`flex-1 h-7 rounded-md text-[11px] font-bold capitalize transition-colors ${post.platform === pl ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {pl === 'x' ? 'X' : pl}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Account / handle</label>
              <input value={post.handle || ''} onChange={(e) => set({ handle: e.target.value })} placeholder="@yourbrand"
                className="w-full h-8 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Content</label>
              <textarea value={post.content} onChange={(e) => set({ content: e.target.value })} rows={5} placeholder="Write your post…"
                className="w-full px-2.5 py-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none resize-none" />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Image</label>
              <div className="flex items-center gap-2">
                {post.image_url && <img src={post.image_url} alt="" className="w-9 h-9 rounded-md object-cover ring-1 ring-slate-200" />}
                <label className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 cursor-pointer">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); }} disabled={!privy || uploading} />
                </label>
                {post.image_url && <button onClick={() => set({ image_url: null })} className="text-[12px] text-slate-400 hover:text-rose-600">Remove</button>}
              </div>
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <MessageCircle className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Comments</span>
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded px-1.5 tabular-nums">{post.comments.filter((c) => !c.resolved).length}</span>
            </div>
            {post.comments.length === 0 && <p className="text-[12px] text-slate-400">No comments yet — click the post preview to add one.</p>}
            <div className="space-y-2.5">
              {post.comments.map((c) => {
                const pin = pinnedIds.indexOf(c.id);
                return (
                  <div key={c.id} className={`rounded-lg ring-1 p-2.5 ${c.resolved ? 'ring-slate-100 bg-slate-50/60 opacity-60' : 'ring-slate-200/70 bg-white'}`}>
                    <div className="flex items-center gap-1.5">
                      {pin >= 0 && <span className="w-4.5 h-4.5 min-w-[18px] h-[18px] rounded-full rounded-bl-none bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">{pin + 1}</span>}
                      <span className="text-[12px] font-bold text-slate-700 truncate">{c.author}</span>
                      <button onClick={() => toggleResolved(c.id, !c.resolved)} title={c.resolved ? 'Reopen' : 'Resolve'}
                        className="ml-auto p-0.5 rounded text-slate-300 hover:text-emerald-600">
                        {c.resolved ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Circle className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className={`mt-1 text-[12.5px] leading-snug ${c.resolved ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{c.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
