'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, MessageCircle, Loader2 } from 'lucide-react';
import { loadPosts, savePost, type PostListItem } from '@/lib/crm/data';

const PLATFORM_CHIP: Record<string, string> = {
  instagram: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200/60',
  facebook: 'bg-blue-50 text-blue-700 ring-blue-200/60',
  x: 'bg-slate-100 text-slate-700 ring-slate-200/60',
  linkedin: 'bg-sky-50 text-sky-700 ring-sky-200/60',
};
const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  in_review: 'bg-amber-50 text-amber-700 ring-amber-200/60',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200/60',
  published: 'bg-blue-50 text-blue-700 ring-blue-200/60',
};

export default function PostsPage() {
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
    else if (res.error) alert(res.error.includes('save_post') ? 'Run migration 0028 first.' : res.error);
  };

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Posts</h1>
        <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-md px-1.5 py-0.5 tabular-nums">{posts.length}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        <span className="text-[12px] text-slate-400 hidden sm:inline">Preview, review & approve social posts with your team and clients</span>
        <button onClick={newPost} disabled={!privy || creating} title={!privy ? 'Sign in to create' : ''}
          className="ml-auto h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} New post
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="h-40 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : posts.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-[13px] text-slate-400">No posts yet — create your first one.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
            {posts.map((p) => (
              <button key={p.id} onClick={() => router.push(`/marketing/posts/${p.id}`)}
                className="text-left rounded-xl bg-white ring-1 ring-slate-200/60 overflow-hidden hover:ring-slate-300 hover:shadow-soft-md hover:-translate-y-0.5 transition-all">
                {p.image_url
                  ? <img src={p.image_url} alt="" className="w-full h-36 object-cover" />
                  : <div className="w-full h-36 bg-slate-50 flex items-center justify-center text-slate-300 text-[12px] px-6 text-center line-clamp-3">{p.content || 'Text post'}</div>}
                <div className="p-3.5">
                  <p className="text-[13px] text-slate-700 line-clamp-2 min-h-[2.4em]">{p.content || '—'}</p>
                  <div className="flex items-center gap-1.5 mt-3">
                    <span className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 capitalize ${PLATFORM_CHIP[p.platform] || PLATFORM_CHIP.x}`}>{p.platform}</span>
                    <span className={`px-1.5 py-0.5 rounded-md text-[11px] font-semibold ring-1 capitalize ${STATUS_CHIP[p.status] || STATUS_CHIP.draft}`}>{p.status.replace('_', ' ')}</span>
                    {p.comment_count > 0 && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-primary-700"><MessageCircle className="w-3.5 h-3.5" /> {p.comment_count}</span>
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
