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
    arrayMove, 
    SortableContext, 
    sortableKeyboardCoordinates, 
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Users, Loader2, GripVertical, Mail, Calendar, CheckCircle, ArrowLeft, MoreHorizontal, ExternalLink } from 'lucide-react';
import Link from 'next/link';

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
            className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-3 group transition-all hover:border-primary-300 hover:shadow-md ${isOverlay ? 'shadow-2xl border-primary-400 rotate-2' : ''}`}
        >
            <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
                    <h4 className="font-bold text-gray-900 group-hover:text-primary-600 transition truncate pr-2">{candidate.full_name}</h4>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest truncate">{candidate.position_title}</p>
                </div>
                <div 
                    {...attributes} 
                    {...listeners} 
                    className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-gray-600 transition"
                >
                    <GripVertical className="w-4 h-4" />
                </div>
            </div>

            <div className="flex items-center justify-between mt-4">
                <div className="flex -space-x-2">
                    {candidate.assessment_results?.[0]?.overall_score ? (
                        <div className="w-8 h-8 rounded-full bg-indigo-50 border-2 border-white flex items-center justify-center text-[10px] font-black text-indigo-700 shadow-sm" title="Neuro Score">
                            {candidate.assessment_results[0].overall_score}
                        </div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-50 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-300 shadow-sm">
                            ?
                        </div>
                    )}
                </div>
                <Link 
                    href={`/dashboard/candidates/${candidate.id}`}
                    className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition"
                >
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
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-gray-700 uppercase tracking-widest">{title}</h3>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                        {candidates.length}
                    </span>
                </div>
                <button className="text-gray-300 hover:text-gray-600"><MoreHorizontal className="w-4 h-4" /></button>
            </div>
            
            <div 
                ref={setNodeRef}
                className="flex-1 bg-gray-100/50 rounded-2xl p-3 overflow-y-auto no-scrollbar border-2 border-transparent hover:border-gray-200 transition"
            >
                <SortableContext 
                    items={candidates.map(c => c.id)} 
                    strategy={verticalListSortingStrategy}
                >
                    {candidates.map(c => (
                        <CandidateCard key={c.id} candidate={c} />
                    ))}
                </SortableContext>
                {candidates.length === 0 && (
                    <div className="h-24 border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-xs text-gray-400 font-medium">
                        Empty
                    </div>
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
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: privyUserId, is_local: false });
            const { data, error } = await supabase.rpc('get_candidates_for_recruiter', { p_privy_user_id: privyUserId });
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

    if (!ready || loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50"><Loader2 className="animate-spin w-10 h-10 text-primary-600" /></div>;

    return (
        <div className="h-screen bg-white flex flex-col">
            <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div className="h-6 w-px bg-gray-200" />
                    <div>
                        <h1 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                            Recruitment Pipeline
                            <span className="text-[8px] bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full uppercase tracking-widest">Live</span>
                        </h1>
                        <p className="text-xs text-gray-500">Drag candidates between stages to update status</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-gray-50 border rounded-xl px-4 py-2 flex items-center gap-2">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span className="text-sm font-bold text-gray-700">{candidates.length} Total</span>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-x-auto overflow-y-hidden bg-white px-6 py-8 custom-scrollbar">
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                >
                    <div className="flex h-full gap-8 min-w-max pb-8">
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
            </main>

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { height: 10px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: #f9fafb; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; border: 3px solid #f9fafb; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
                .no-scrollbar::-webkit-scrollbar { display: none; }
            `}</style>
        </div>
    );
}
