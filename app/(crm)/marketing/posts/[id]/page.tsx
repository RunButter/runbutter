'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Check, Copy, Link2, Loader2, Lock, Upload, MessageCircle, CheckCircle2, Circle } from 'lucide-react';
import { uploadImage } from '@/lib/crm/upload';
import {
  loadPost, savePost, addPostComment, setPostCommentResolved,
  type PostDetail, type PostPlatform,
} from '@/lib/crm/data';
import PostCanvas from '@/components/marketing/PostCanvas';
import { useDialog } from '@/components/ui/Dialog';

const PLATFORMS: PostPlatform[] = ['instagram', 'facebook', 'x', 'linkedin'];
const STATUSES = ['draft', 'in_review', 'approved', 'published'];

export default function PostStudio() {
  const { notify } = useDialog();
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
  const [uploadError, setUploadError] = useState('');
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
    if (res.error) { notify(res.error); return; }
    setSaved(true);
    if (!post.live && res.id) router.replace(`/marketing/posts/${res.id}`); else reload();
  };

  const uploadPostImage = async (file: File) => {
    if (!privy) { setUploadError('Sign in to upload images.'); return; }
    setUploading(true); setUploadError('');
    const { url, error } = await uploadImage(privy, null, file, 'posts');
    if (error) setUploadError(error); else set({ image_url: url! });
    setUploading(false);
  };

  const onAddComment = async (body: string, x: number, y: number) => {
    if (post?.live && privy) {
      const res = await addPostComment(privy, id, body, x, y);
      if (res.error) { notify(res.error); return; }
      // Refresh only the comments from the server; keep the user's in-progress
      // edits (uploaded image, caption, status) which a full reload would wipe.
      const fresh = await loadPost(privy, id);
      setPost((p) => (p && fresh ? { ...p, comments: fresh.comments } : (fresh ?? p)));
    } else {
      // sample mode: local-only so the flow is demonstrable
      setPost((p) => p ? { ...p, comments: [...p.comments, { id: `local-${Date.now()}`, author: 'You', body, x, y, resolved: false }] } : p);
    }
  };

  const toggleResolved = async (commentId: string, resolved: boolean) => {
    if (post?.live && privy) {
      await setPostCommentResolved(privy, commentId, resolved);
      const fresh = await loadPost(privy, id);
      setPost((p) => (p && fresh ? { ...p, comments: fresh.comments } : (fresh ?? p)));
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
        <div className="max-w-sm w-full bg-surface rounded-xl ring-1 ring-subtle shadow-sm p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-surface-hover flex items-center justify-center mb-3"><Lock className="w-4 h-4 text-tertiary" /></div>
          <h1 className="text-sm font-semibold text-primary">This post isn’t available</h1>
          <p className="mt-1.5 text-sm text-secondary">Open it from your workspace, or sign in first.</p>
        </div>
      </div>
    );
  }
  if (!post) return <div className="flex-1 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-2 px-6 border-b border-subtle">
        <button onClick={() => router.push('/marketing/posts')} className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary hover:bg-surface-hover"><ArrowLeft className="w-3.5 h-3.5" /> Posts</button>
        <h1 className="text-sm font-semibold text-primary">Post studio</h1>
        <span className={`text-3xs font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${post.live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{post.live ? 'Live' : 'Sample'}</span>
        <div className="ml-auto flex items-center gap-2">
          <select value={post.status} onChange={(e) => set({ status: e.target.value })}
            className="h-7 px-2 text-xs font-semibold rounded-md bg-surface ring-1 ring-subtle outline-none focus:ring-2 focus:ring-accent/30 capitalize">
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          <button onClick={copyReviewLink}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Link2 className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Review link'}
          </button>
          <button onClick={save} disabled={!privy || saving} title={!privy ? 'Sign in to save' : ''}
            className="h-7 px-3 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null} {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div className="flex-1 overflow-auto bg-surface-hover/70 p-8 flex items-start justify-center"
          style={{ backgroundImage: 'radial-gradient(circle, hsl(var(--border-strong)) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          <div className="my-4">
            <PostCanvas post={post} comments={post.comments} canComment onAddComment={onAddComment} />
            <p className="text-center text-2xs text-tertiary mt-4">Click anywhere on the post to leave a pinned comment — like Figma.</p>
          </div>
        </div>

        {/* Sidebar: editor + comments */}
        <aside className="w-80 shrink-0 border-l border-subtle bg-surface overflow-y-auto">
          <div className="p-4 space-y-3 border-b border-subtle">
            <div className="text-2xs font-semibold uppercase tracking-widest text-tertiary">Post</div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1">Platform</label>
              <div className="flex gap-1">
                {PLATFORMS.map((pl) => (
                  <button key={pl} onClick={() => set({ platform: pl })}
                    className={`flex-1 h-7 rounded-md text-2xs font-semibold capitalize transition-colors ${post.platform === pl ? 'bg-inverse text-inverse-fg' : 'bg-surface-hover text-secondary hover:bg-strong'}`}>
                    {pl === 'x' ? 'X' : pl}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1">Account / handle</label>
              <input value={post.handle || ''} onChange={(e) => set({ handle: e.target.value })} placeholder="@yourbrand"
                className="w-full h-8 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1">Content</label>
              <textarea value={post.content} onChange={(e) => set({ content: e.target.value })} rows={5} placeholder="Write your post…"
                className="w-full px-2.5 py-2 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none resize-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-secondary mb-1">Image</label>
              <div className="flex items-center gap-2">
                {post.image_url && <img src={post.image_url} alt="" className="w-9 h-9 rounded-md object-cover ring-1 ring-subtle" />}
                <label className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken cursor-pointer">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Upload
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPostImage(f); }} disabled={!privy || uploading} />
                </label>
                {post.image_url && <button onClick={() => set({ image_url: null })} className="text-xs text-tertiary hover:text-danger">Remove</button>}
              </div>
              {uploadError && <p className="mt-1.5 text-xs text-danger">{uploadError}</p>}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <MessageCircle className="w-3.5 h-3.5 text-tertiary" />
              <span className="text-2xs font-semibold uppercase tracking-widest text-tertiary">Comments</span>
              <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded px-1.5 tabular-nums">{post.comments.filter((c) => !c.resolved).length}</span>
            </div>
            {post.comments.length === 0 && <p className="text-xs text-tertiary">No comments yet — click the post preview to add one.</p>}
            <div className="space-y-2.5">
              {post.comments.map((c) => {
                const pin = pinnedIds.indexOf(c.id);
                return (
                  <div key={c.id} className={`rounded-lg ring-1 p-2.5 ${c.resolved ? 'ring-subtle bg-surface-sunken/60 opacity-60' : 'ring-subtle bg-surface'}`}>
                    <div className="flex items-center gap-1.5">
                      {pin >= 0 && <span className="w-4.5 h-4.5 min-w-[18px] h-[18px] rounded-full rounded-bl-none bg-accent text-accent-fg text-3xs font-semibold flex items-center justify-center">{pin + 1}</span>}
                      <span className="text-xs font-semibold text-secondary truncate">{c.author}</span>
                      <button onClick={() => toggleResolved(c.id, !c.resolved)} title={c.resolved ? 'Reopen' : 'Resolve'}
                        className="ml-auto p-0.5 rounded text-tertiary hover:text-success">
                        {c.resolved ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Circle className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className={`mt-1 text-xs leading-snug ${c.resolved ? 'text-tertiary line-through' : 'text-secondary'}`}>{c.body}</p>
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
