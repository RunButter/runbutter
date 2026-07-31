'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, Handle, Position, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Trash2, Check, Loader2 } from 'lucide-react';
import type { MindMapGraph } from '@/lib/crm/mindmaps';

/**
 * Free-form canvas: boxes you move, connected by edges.
 *
 * The node is our own component rather than React Flow's default, so a box is a
 * card from this design system — same surface, radius and type scale as every
 * other card — instead of the library's built-in look, which would arrive as a
 * second visual vocabulary on the one screen that is most obviously "ours".
 */

type BoxData = { label: string };

function BoxNode({ id, data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState((data as BoxData).label ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setText((data as BoxData).label ?? ''); }, [data]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    // The canvas owns the graph, so the node reports upward rather than holding
    // its own copy — otherwise the text you typed would not survive a save.
    window.dispatchEvent(new CustomEvent('mindmap:rename', { detail: { id, label: text } }));
  };

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={`card-surface px-4 py-3 min-w-[168px] max-w-[280px] transition-shadow ${
        selected ? 'ring-2 ring-accent shadow-elevated' : ''
      }`}
    >
      {/* Handles on all four sides: a mind map grows in every direction, and
          forcing left-to-right (the flow-chart default) makes people fight the
          canvas to lay out anything radial. */}
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-strong !border-0" />
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-strong !border-0" />
      {editing ? (
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { setText((data as BoxData).label ?? ''); setEditing(false); }
          }}
          rows={2}
          className="w-full resize-none bg-transparent text-sm text-primary outline-none"
        />
      ) : (
        <p className="text-sm text-primary whitespace-pre-wrap break-words">
          {(data as BoxData).label || <span className="text-tertiary">Double-click to edit</span>}
        </p>
      )}
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-accent !border-0" />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-accent !border-0" />
    </div>
  );
}

const nodeTypes = { box: BoxNode };

function Canvas({ initial, onDirty }: { initial: MindMapGraph; onDirty: (g: MindMapGraph) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>((initial.nodes as Node[]) ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>((initial.edges as Edge[]) ?? []);

  // Report the graph upward on every change. The parent debounces before it
  // saves — persisting on each pixel of a drag would be a request per frame.
  useEffect(() => { onDirty({ nodes, edges }); }, [nodes, edges, onDirty]);

  useEffect(() => {
    const rename = (e: Event) => {
      const { id, label } = (e as CustomEvent).detail;
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)));
    };
    window.addEventListener('mindmap:rename', rename);
    return () => window.removeEventListener('mindmap:rename', rename);
  }, [setNodes]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, type: 'default', markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges],
  );

  const addBox = useCallback(() => {
    const id = `n${Date.now().toString(36)}`;
    // Dropped near the middle with a little scatter, so repeated adds don't
    // stack into one illegible pile.
    setNodes((ns) => [...ns, {
      id, type: 'box',
      position: { x: 120 + Math.random() * 240, y: 80 + Math.random() * 200 },
      data: { label: '' },
    }]);
  }, [setNodes]);

  const removeSelected = useCallback(() => {
    setNodes((ns) => ns.filter((n) => !n.selected));
    setEdges((es) => es.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  const selectedCount = useMemo(
    () => nodes.filter((n) => n.selected).length + edges.filter((e) => e.selected).length,
    [nodes, edges],
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="!bg-canvas" color="hsl(var(--border-strong))" />
        <Controls showInteractive={false} className="!shadow-card" />
        <MiniMap pannable zoomable className="!bg-surface !rounded-xl" maskColor="hsl(var(--canvas) / 0.7)" />
      </ReactFlow>

      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button onClick={addBox}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-inverse-fg bg-inverse shadow-sm hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> Add box
        </button>
        {selectedCount > 0 && (
          <button onClick={removeSelected}
            className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-danger bg-surface shadow-sm hover:bg-surface-hover transition-colors">
            <Trash2 className="w-4 h-4" /> Delete {selectedCount}
          </button>
        )}
      </div>
    </div>
  );
}

export default function MindMapCanvas({
  initial, saving, savedAt, onDirty,
}: {
  initial: MindMapGraph;
  saving: boolean;
  savedAt: string;
  onDirty: (g: MindMapGraph) => void;
}) {
  return (
    <ReactFlowProvider>
      <div className="relative h-full w-full">
        <Canvas initial={initial} onDirty={onDirty} />
        {/* Autosave has no button, so it has to say so — a canvas that saves
            invisibly is one people back out of because they cannot tell. */}
        <div className="absolute top-3 right-3 z-10 text-2xs text-tertiary bg-surface/90 rounded-lg px-2 py-1 shadow-sm inline-flex items-center gap-1.5">
          {saving
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
            : <><Check className="w-3 h-3 text-success" /> {savedAt || 'Saved'}</>}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
