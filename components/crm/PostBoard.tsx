'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, Check, MessageCircle, CalendarDays, Plus } from 'lucide-react';
import type { PostListItem } from '@/lib/crm/data';
import { autoPlace, savePostBoard, type PostBoardGraph } from '@/lib/crm/postboard';

/**
 * The content plan as a canvas: every post as a card you drag, with arrows
 * showing which post leads to which.
 *
 * Neither existing view can express that. The calendar answers "what goes out
 * when" and the grid answers "what exists" — but a campaign is a SEQUENCE
 * (teaser → launch → follow-up → recap), and the reason a post exists is
 * usually another post. That relationship had nowhere to live.
 *
 * A node here is a real post row, not a copy of one. Positions and edges are
 * the only things the board owns; the cards are rendered from the live post
 * list on every open. So a post deleted from the calendar just stops being
 * drawn, and one created there appears needing a place — self-healing, with no
 * second source of truth to drift.
 */

const PLATFORM_CHIP: Record<string, string> = {
  instagram: 'bg-accent/10 text-accent',
  facebook: 'bg-accent/10 text-accent',
  x: 'bg-surface-hover text-secondary',
  linkedin: 'bg-success/10 text-success',
};
const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-surface-hover text-secondary',
  in_review: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  published: 'bg-accent/10 text-accent',
};

type PostNodeData = { post: PostListItem };

function PostNode({ data, selected }: NodeProps) {
  const post = (data as PostNodeData).post;
  const when = post.scheduled_at ? new Date(post.scheduled_at) : null;

  return (
    <div
      className={`card-surface !rounded-lg w-[220px] overflow-hidden transition-shadow ${
        selected ? 'ring-2 ring-accent shadow-elevated' : ''
      }`}
    >
      {/* Four handles, like the mind map: a content plan branches (one launch
          post feeding three follow-ups), so forcing left-to-right would make
          people fight the canvas. */}
      <Handle id="l" type="target" position={Position.Left} className="!w-2 !h-2 !bg-strong !border-0" />
      <Handle id="t" type="target" position={Position.Top} className="!w-2 !h-2 !bg-strong !border-0" />

      {post.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.image_url} alt="" draggable={false} className="w-full h-[110px] object-cover" />
      )}

      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className={`text-3xs px-1.5 py-0.5 rounded ${PLATFORM_CHIP[post.platform] || PLATFORM_CHIP.x}`}>{post.platform}</span>
          <span className={`text-3xs px-1.5 py-0.5 rounded ${STATUS_CHIP[post.status] || STATUS_CHIP.draft}`}>
            {post.status.replace('_', ' ')}
          </span>
        </div>

        <p className="text-2xs text-primary line-clamp-3 whitespace-pre-wrap break-words min-h-[3rem]">
          {post.content || <span className="text-tertiary">Empty post</span>}
        </p>

        <div className="flex items-center gap-2 mt-2 text-3xs text-tertiary">
          {when ? (
            <span className="flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              {when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          ) : (
            // Said plainly rather than left blank: "no date" is the single most
            // useful thing to see on a planning board.
            <span className="text-warning">Unscheduled</span>
          )}
          {post.comment_count > 0 && (
            <span className="flex items-center gap-1 ml-auto"><MessageCircle className="w-3 h-3" />{post.comment_count}</span>
          )}
        </div>
      </div>

      <Handle id="r" type="source" position={Position.Right} className="!w-2 !h-2 !bg-accent !border-0" />
      <Handle id="b" type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-accent !border-0" />
    </div>
  );
}

const nodeTypes = { post: PostNode };

function Canvas({
  posts, graph, onDirty, onOpen,
}: { posts: PostListItem[]; graph: PostBoardGraph; onDirty: (g: PostBoardGraph) => void; onOpen: (id: string) => void }) {
  const positions = useMemo(() => autoPlace(posts.map((p) => p.id), graph.positions), [posts, graph.positions]);

  const initialNodes = useMemo<Node[]>(() => posts.map((p) => ({
    id: p.id, type: 'post',
    position: positions[p.id] ?? { x: 0, y: 0 },
    data: { post: p },
  })), [posts, positions]);

  // Edges are filtered to posts that still exist. An edge whose post was
  // deleted elsewhere would otherwise render as an arrow into empty space.
  const livePostIds = useMemo(() => new Set(posts.map((p) => p.id)), [posts]);
  const initialEdges = useMemo<Edge[]>(() => graph.edges
    .filter((e) => livePostIds.has(e.source) && livePostIds.has(e.target))
    .map((e) => ({ ...e, type: 'default', markerEnd: { type: MarkerType.ArrowClosed } } as Edge)),
    [graph.edges, livePostIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  // Keep the cards in sync when the post list changes underneath (a rename on
  // the calendar, a new post): positions are preserved, content is refreshed.
  useEffect(() => {
    setNodes((ns) => {
      const byId = new Map(ns.map((n) => [n.id, n]));
      return posts.map((p) => {
        const existing = byId.get(p.id);
        return existing
          ? { ...existing, data: { post: p } }
          : { id: p.id, type: 'post', position: positions[p.id] ?? { x: 0, y: 0 }, data: { post: p } } as Node;
      });
    });
  }, [posts, positions, setNodes]);

  useEffect(() => {
    onDirty({
      positions: Object.fromEntries(nodes.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }])),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
    });
  }, [nodes, edges, onDirty]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, type: 'default', markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDoubleClick={(_, n) => onOpen(n.id)}
      nodeTypes={nodeTypes}
      fitView
      // Capped at 1: fitView on a three-post board otherwise zooms the cards to
      // ~1.4x and they read as a mistake.
      fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
      proOptions={{ hideAttribution: false }}
      className="bg-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className="!bg-surface" />
    </ReactFlow>
  );
}

export default function PostBoard({
  posts, graph, ws, privy, onNew,
}: { posts: PostListItem[]; graph: PostBoardGraph; ws: string | null; privy: string | null; onNew: () => void }) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState('');
  const pending = useRef<PostBoardGraph | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  const onDirty = useCallback((g: PostBoardGraph) => {
    // The first report is just the canvas describing what it was handed. Saving
    // it would write a board on every open, including for people who only
    // looked — and would stamp auto-placed positions as though someone chose
    // them.
    if (first.current) { first.current = false; return; }
    if (!ws || !privy) return;
    pending.current = g;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const g2 = pending.current;
      if (!g2) return;
      setStatus('saving');
      const { error } = await savePostBoard(privy, ws, g2);
      if (error) { setStatus('error'); setErr(error); }
      else { setStatus('saved'); setErr(''); }
    }, 700);
  }, [ws, privy]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (posts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-secondary">No posts yet. The board fills up as you create them.</p>
        <button onClick={onNew} className="text-xs px-3 h-8 rounded-lg bg-inverse text-inverse-fg inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> New post
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        {status === 'saving' && <span className="text-2xs text-tertiary flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Saving</span>}
        {status === 'saved' && <span className="text-2xs text-tertiary flex items-center gap-1"><Check className="w-3 h-3" />Saved</span>}
        {status === 'error' && <span className="text-2xs text-danger">{err || 'Could not save'}</span>}
      </div>
      {/* Top-left, not bottom-left: React Flow's zoom Controls sit bottom-left
          and the hint printed straight through them. */}
      <p className="absolute top-3 left-3 z-10 text-2xs text-tertiary pointer-events-none">
        Drag to arrange · drag a dot to connect · double-click a card to edit
      </p>
      <ReactFlowProvider>
        <Canvas posts={posts} graph={graph} onDirty={onDirty} onOpen={(id) => router.push(`/marketing/posts/${id}`)} />
      </ReactFlowProvider>
    </div>
  );
}
