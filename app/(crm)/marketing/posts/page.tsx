'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Plus, MessageCircle, Loader2, CalendarDays, LayoutGrid, Workflow } from 'lucide-react';
import { loadPosts, savePost, setPostSchedule, type PostListItem } from '@/lib/crm/data';
import PostCalendar from '@/components/crm/PostCalendar';
import PostBoard from '@/components/crm/PostBoard';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { loadPostBoard, EMPTY_BOARD, type PostBoardGraph } from '@/lib/crm/postboard';
import { useDialog } from '@/components/ui/Dialog';
import DataBadge from '@/components/ui/DataBadge';
import AppLoading from '@/components/ui/AppLoading';

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
  // Calendar first: planning is the job people come to Post Studio for, and the
  // grid only ever answered "what exists", never "what goes out when".
  const [view, setView] = useState<'calendar' | 'board' | 'grid'>('calendar');
  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [board, setBoard] = useState<PostBoardGraph>(EMPTY_BOARD);

  useEffect(() => {
    if (!ready) return;
    loadPosts(privy).then((res) => { setPosts(res.posts); setLive(res.live); setLoading(false); });
    // The board is loaded alongside, not on tab switch, so flipping to it is
    // instant rather than showing a second spinner.
    if (privy) {
      getWorkspace(privy).then((w) => {
        if (!w) return;
        setWs(w);
        loadPostBoard(privy, w.id).then(setBoard);
      });
    }
  }, [ready, privy]);

  const newPost = async () => {
    if (!privy) return;
    setCreating(true);
    const res = await savePost(privy, null, { platform: 'instagram', status: 'draft', content: '' });
    setCreating(false);
    if (res.id) router.push(`/marketing/posts/${res.id}`);
    else if (res.error) notify(res.error);
  };

  // Optimistic: a drag should land instantly. On failure the post snaps back and
  // the reason is shown, rather than the card sitting on a day it never reached.
  const reschedule = async (id: string, at: string | null) => {
    if (!privy) return;
    const before = posts;
    setPosts((ps) => ps.map((p) => (p.id === id ? { ...p, scheduled_at: at } : p)));
    const { error } = await setPostSchedule(privy, id, at);
    if (error) { setPosts(before); notify(error); }
  };

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-5 lg:px-7">
        <h1 className="text-md font-medium text-primary">Posts</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{posts.length}</span>
        <DataBadge live={live} />
        <span className="text-xs text-tertiary hidden sm:inline">Preview, review & approve social posts with your team and clients</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-surface-hover p-0.5">
            {([['calendar', CalendarDays, 'Calendar'], ['board', Workflow, 'Board'], ['grid', LayoutGrid, 'Grid']] as const).map(([v, Icon, label]) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === v ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'
                }`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
          <button onClick={newPost} disabled={!privy || creating} title={!privy ? 'Sign in to create' : ''}
            className="h-10 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-inverse-fg bg-inverse hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New post
          </button>
        </div>
      </header>

      {/* The board owns its own scrolling and fills the pane — wrapping it in
          the padded, scrolling container the other two views use would give a
          canvas a scrollbar, which fights panning. */}
      {view === 'board' && !loading ? (
        <div className="flex-1 min-h-0">
          <PostBoard posts={posts} graph={board} ws={ws?.id ?? null} privy={privy} onNew={newPost} />
        </div>
      ) : (
      <div className="flex-1 overflow-auto p-6 2xl:p-8">
        {loading ? (
          <AppLoading />
        ) : posts.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-tertiary">No posts yet — create your first one.</div>
        ) : view === 'calendar' ? (
          <div className="max-w-5xl">
            <PostCalendar posts={posts} onOpen={(id) => router.push(`/marketing/posts/${id}`)} onReschedule={reschedule} />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
            {posts.map((p) => (
              <button key={p.id} onClick={() => router.push(`/marketing/posts/${p.id}`)}
                className="text-left card-surface overflow-hidden hover:ring-strong hover:shadow-soft-md hover:-translate-y-0.5 transition-all">
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
      )}
    </>
  );
}
