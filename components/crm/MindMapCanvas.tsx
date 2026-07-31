'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState, Handle, Position, MarkerType, useReactFlow,
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

type BoxData = { label: string; image?: string | null };

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
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={`card-surface !rounded-lg px-4 py-3 min-w-[168px] max-w-[280px] transition-shadow ${
        selected ? 'ring-2 ring-accent shadow-elevated' : ''
      }`}
    >
      {/* Handles on all four sides: a mind map grows in every direction, and
          forcing left-to-right (the flow-chart default) makes people fight the
          canvas to lay out anything radial. */}
      <Handle id="l" type="target" position={Position.Left} className="!w-2 !h-2 !bg-strong !border-0" />
      <Handle id="t" type="target" position={Position.Top} className="!w-2 !h-2 !bg-strong !border-0" />
      {(data as BoxData).image && (
        // Capped rather than natural size: a phone screenshot pasted at full
        // resolution would otherwise become a node several thousand pixels wide
        // and make the canvas unusable.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={(data as BoxData).image as string}
          alt=""
          draggable={false}
          className="mb-2 w-full max-h-[180px] object-cover rounded-md"
        />
      )}
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
          {(data as BoxData).label
            || ((data as BoxData).image ? null : <span className="text-tertiary">Double-click to edit, or paste an image</span>)}
        </p>
      )}
      <Handle id="r" type="source" position={Position.Right} className="!w-2 !h-2 !bg-accent !border-0" />
      <Handle id="b" type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-accent !border-0" />
    </div>
  );
}

const nodeTypes = { box: BoxNode };

function Canvas({ initial, onDirty }: { initial: MindMapGraph; onDirty: (g: MindMapGraph) => void }) {
  const { screenToFlowPosition } = useReactFlow();
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

  // Paste an image straight onto the selected box.
  //
  // Stored as a data URI in the graph rather than uploaded. That is a deliberate
  // trade: it keeps a paste instant and offline, and the graph is already capped
  // at 2 MB server-side, which bounds the damage — a screenshot or two fits, a
  // photo library does not, and save_mind_map rejects the overflow with a
  // message rather than silently truncating. Uploading to storage would be the
  // right call once maps routinely carry many images.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      // Let a normal text paste into the textarea behave normally.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const file = Array.from(e.clipboardData?.items ?? [])
        .find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
      if (!file) return;
      e.preventDefault();

      const selected = nodes.filter((n) => n.selected);
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result);
        if (selected.length > 0) {
          setNodes((ns) => ns.map((n) => (n.selected ? { ...n, data: { ...n.data, image: src } } : n)));
        } else {
          // Nothing selected: the image becomes its own box rather than being
          // dropped on the floor.
          setNodes((ns) => [...ns, {
            id: `n${Date.now().toString(36)}`, type: 'box',
            position: { x: 160 + Math.random() * 200, y: 120 + Math.random() * 160 },
            data: { label: '', image: src },
          }]);
        }
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [nodes, setNodes]);

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

  /**
   * Double-click empty canvas to create a box THERE.
   *
   * screenToFlowPosition is what makes this correct under pan and zoom — using
   * raw client coordinates would drop the box wherever that pixel happens to be
   * in an unzoomed, unpanned canvas, which is only the right answer at 100% with
   * the view at the origin. The offset centres the box on the cursor.
   */
  const onPaneDoubleClick = useCallback((e: React.MouseEvent) => {
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes((ns) => [...ns, {
      id: `n${Date.now().toString(36)}`, type: 'box',
      position: { x: at.x - 84, y: at.y - 24 },
      data: { label: '' },
      selected: true,
    }]);
  }, [screenToFlowPosition, setNodes]);

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
        onDoubleClick={onPaneDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        // Cap at 1:1. fitView scales to fill the viewport, so a map with three
        // boxes opened at ~1.4x — text and images blown up past their designed
        // size, and every subsequent box arriving apparently huge.
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        proOptions={{ hideAttribution: false }}
        deleteKeyCode={['Backspace', 'Delete']}
        className="bg-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} className="!bg-canvas" color="hsl(var(--border-strong))" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="hsl(var(--border-strong))" maskColor="hsl(var(--canvas) / 0.72)" />
      </ReactFlow>

      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button onClick={addBox}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-inverse-fg bg-inverse shadow-sm hover:opacity-90 transition-opacity">
          <Plus className="w-4 h-4" /> Add box
        </button>
        <span className="hidden sm:inline text-2xs text-tertiary bg-surface/90 rounded-lg px-2 py-1.5 shadow-sm">
          Double-click the canvas to add · paste an image onto a box
        </span>
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
