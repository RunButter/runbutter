'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, MessageCircle, Loader2 } from 'lucide-react';
import { loadPosts, savePost, type PostListItem } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';

const PLATFORM_CHIP: Record<string, string> = {
  instagram: 'bg-accent/10 text-accent ring-accent/30',
  facebook: 'bg-accent/10 text-accent ring-accent/30',
  x: 'bg-surface-hover text-secondary ring-subtle',
  linkedin: 'bg-success/10 text-success ring-success/30',
};
const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-surface-hover text-secondary ring-subtle',
  in_review: 'bg-warning/10 text-warning ring-warning/30',
  approved: 'bg-success/10 text-success ring-success/30',
  published: 'bg-accent/10 text-accent ring-accent/30',
};

export default function PostsPage() {
  const { notify } = useDialog();
  const router = useRouter();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!ready) return;
    loadPosts(privy).then((res) => { setPosts(res.posts); setLive(res.live); setLoading(false); });
  }, [ready, privy]);

  const newPost = async () => {
    if (!privy) return;
    setCreating(true);
    const res = await savePost(privy, null, { platform: 'instagram', status: 'draft', content: '' });
    setCreating(false);
    if (res.id) router.push(`/marketing/posts/${res.id}`);
    else if (res.error) notify(res.error);
  };

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-6 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary">Posts</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{posts.length}</span>
        <span className={`text-3xs font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{live ? 'Live' : 'Sample'}</span>
        <span className="text-xs text-tertiary hidden sm:inline">Preview, review & approve social posts with your team and clients</span>
        <button onClick={newPost} disabled={!privy || creating} title={!privy ? 'Sign in to create' : ''}
          className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40 disabled:cursor-not-allowed">
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New post
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : posts.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-tertiary">No posts yet — create your first one.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
            {posts.map((p) => (
              <button key={p.id} onClick={() => router.push(`/marketing/posts/${p.id}`)}
                className="text-left rounded-xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden hover:ring-strong hover:shadow-soft-md hover:-translate-y-0.5 transition-all">
                {p.image_url
                  ? <img src={p.image_url} alt="" className="w-full h-36 object-cover" />
                  : <div className="w-full h-36 bg-surface-sunken flex items-center justify-center text-tertiary text-xs px-6 text-center line-clamp-3">{p.content || 'Text post'}</div>}
                <div className="p-3.5">
                  <p className="text-sm text-secondary line-clamp-2 min-h-[2.4em]">{p.content || '—'}</p>
                  <div className="flex items-center gap-1.5 mt-3">
                    <span className={`px-1.5 py-0.5 rounded-md text-2xs font-semibold ring-1 capitalize ${PLATFORM_CHIP[p.platform] || PLATFORM_CHIP.x}`}>{p.platform}</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-2xs font-semibold ring-1 capitalize ${STATUS_CHIP[p.status] || STATUS_CHIP.draft}`}>{p.status.replace('_', ' ')}</span>
                    {p.comment_count > 0 && (
                      <span className="ml-auto inline-flex items-center gap-1 text-2xs font-semibold text-accent"><MessageCircle className="w-3.5 h-3.5" /> {p.comment_count}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
