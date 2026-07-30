'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    DndContext,
    DragOverlay,
    closestCorners,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragStartEvent,
    DragOverEvent,
    DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Loader2, GripVertical, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import PageHeader from '@/components/dashboard/PageHeader';
import { rpc } from '@/lib/rpc';

// --- Types & Constants ---
const COLUMNS = [
    { id: 'applied', title: 'New Applied' },
    { id: 'screening', title: 'Initial Screening' },
    { id: 'assessment_sent', title: 'Assessments' },
    { id: 'interview_scheduled', title: 'Interviews' },
    { id: 'hired', title: 'Offers & Hired' }
];

const STATUS_MAP: Record<string, string> = {
    'applied': 'applied',
    'screening': 'screening',
    'assessment_sent': 'assessment_sent',
    'assessment_completed': 'assessment_sent',
    'interview_scheduled': 'interview_scheduled',
    'interviewed': 'interview_scheduled',
    'offered': 'hired',
    'hired': 'hired'
};

// --- Sortable Candidate Card ---
function CandidateCard({ candidate, isOverlay = false }: { candidate: any, isOverlay?: boolean }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: candidate.id,
        data: {
            type: 'Candidate',
            candidate
        }
    });

    const style = {
        transition,
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.3 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`group bg-surface p-3 rounded-lg ring-1 ring-subtle mb-2 transition-all hover:ring-strong hover:shadow-elevated ${isOverlay ? 'shadow-popover ring-accent/30 rotate-2' : ''}`}
        >
            <div className="flex justify-between items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-semibold text-primary group-hover:text-accent transition-colors truncate">{candidate.full_name}</h4>
                    <p className="text-3xs text-tertiary font-semibold uppercase tracking-wide truncate">{candidate.position_title}</p>
                </div>
                <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-0.5 -mr-1 text-tertiary hover:text-secondary transition-colors">
                    <GripVertical className="w-4 h-4" />
                </div>
            </div>

            <div className="flex items-center justify-between mt-3">
                {candidate.assessment_results?.[0]?.overall_score ? (
                    <div className="w-7 h-7 rounded-full bg-accent/10 ring-1 ring-accent/20 flex items-center justify-center text-3xs font-semibold text-accent tabular-nums" title="Match score">
                        {candidate.assessment_results[0].overall_score}
                    </div>
                ) : (
                    <div className="w-7 h-7 rounded-full bg-surface-sunken ring-1 ring-subtle flex items-center justify-center text-3xs font-semibold text-tertiary">?</div>
                )}
                <Link href={`/dashboard/candidates/${candidate.id}`} onClick={(e) => e.stopPropagation()}
                    className="p-1.5 text-tertiary hover:text-accent hover:bg-surface-hover rounded-md transition-colors">
                    <ExternalLink className="w-3.5 h-3.5" />
                </Link>
            </div>
        </div>
    );
}

// --- Kanban Column ---
function KanbanColumn({ id, title, candidates }: { id: string, title: string, candidates: any[] }) {
    const { setNodeRef } = useSortable({
        id: id,
        data: {
            type: 'Column',
            id
        }
    });

    return (
        <div className="w-72 flex-shrink-0 flex flex-col h-full overflow-hidden">
            <div className="flex items-center gap-2 mb-2 px-1">
                <h3 className="text-2xs font-semibold text-secondary uppercase tracking-wider">{title}</h3>
                <span className="bg-strong text-secondary text-3xs font-semibold px-1.5 py-0.5 rounded-md min-w-[20px] text-center tabular-nums">{candidates.length}</span>
            </div>

            <div ref={setNodeRef} className="flex-1 bg-surface-sunken ring-1 ring-subtle rounded-xl p-2 overflow-y-auto no-scrollbar transition-colors">
                <SortableContext items={candidates.map(c => c.id)} strategy={verticalListSortingStrategy}>
                    {candidates.map(c => (
                        <CandidateCard key={c.id} candidate={c} />
                    ))}
                </SortableContext>
                {candidates.length === 0 && (
                    <div className="h-20 ring-1 ring-dashed ring-subtle rounded-lg flex items-center justify-center text-2xs text-tertiary font-medium">Empty</div>
                )}
            </div>
        </div>
    );
}

// --- Main Page Component ---
export default function PipelinePage() {
    const router = useRouter();
    const { ready, authenticated, user } = usePrivy();
    const [loading, setLoading] = useState(true);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const loadCandidates = useCallback(async (privyUserId: string) => {
        try {
            const { data, error } = await rpc('get_candidates_for_recruiter', { p_privy_user_id: privyUserId });
            if (error) throw error;
            setCandidates(data || []);
        } catch (error) {
            console.error('Error loading pipeline:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (ready) {
            if (!authenticated) router.push('/auth/login');
            else if (user) loadCandidates(user.id);
        }
    }, [ready, authenticated, user, router, loadCandidates]);

    const activeCandidate = useMemo(() =>
        activeId ? candidates.find(c => c.id === activeId) : null
        , [activeId, candidates]);

    const groupedCandidates = useMemo(() => {
        const groups: Record<string, any[]> = {};
        COLUMNS.forEach(col => groups[col.id] = []);
        candidates.forEach(c => {
            const group = STATUS_MAP[c.status] || 'applied';
            if (groups[group]) groups[group].push(c);
        });
        return groups;
    }, [candidates]);

    // --- Drag Handlers ---
    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
        if (!over) return;

        const activeCandidate = candidates.find(c => c.id === active.id);
        if (!activeCandidate) return;

        // Determine target column
        let targetStatus = '';
        const overData = over.data.current;

        if (overData?.type === 'Column') {
            targetStatus = overData.id;
        } else if (overData?.type === 'Candidate') {
            targetStatus = STATUS_MAP[overData.candidate.status] || 'applied';
        }

        if (targetStatus && (STATUS_MAP[activeCandidate.status] || 'applied') !== targetStatus) {
            // Optimistically update
            setCandidates(prev => prev.map(c =>
                c.id === active.id ? { ...c, status: targetStatus } : c
            ));
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) return;

        const candidate = candidates.find(c => c.id === active.id);
        if (candidate && user) {
            // Persist to database
            try {
                const res = await fetch('/api/candidates/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        candidateId: candidate.id,
                        status: candidate.status,
                        privyUserId: user.id
                    })
                });
                if (!res.ok) throw new Error('Refresh failed');
            } catch (err) {
                console.error('Failed to persist status:', err);
                loadCandidates(user.id); // Revert on failure
            }
        }
    };

    if (!ready || loading) return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin w-8 h-8 text-tertiary" /></div>;

    return (
        <div className="flex flex-col h-full">
            <PageHeader title="Hiring pipeline" count={candidates.length} />
            <div className="flex-1 overflow-x-auto p-4">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                >
                    <div className="flex h-full gap-4 min-w-max pb-2">
                        {COLUMNS.map(column => (
                            <KanbanColumn
                                key={column.id}
                                id={column.id}
                                title={column.title}
                                candidates={groupedCandidates[column.id] || []}
                            />
                        ))}
                    </div>

                    <DragOverlay>
                        {activeId ? (
                            <CandidateCard candidate={activeCandidate} isOverlay />
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>
        </div>
    );
}
