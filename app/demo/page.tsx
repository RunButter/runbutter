'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { 
    Users, Briefcase, CheckCircle, Calendar, TrendingUp, Clock, 
    Loader2, CreditCard, Lock, Building2, Search, Filter, 
    Mail, ExternalLink, GripVertical, MoreHorizontal, ArrowLeft,
    Brain, Target, BarChart, ChevronRight, User, Phone, Linkedin, FileText, AlertCircle
} from 'lucide-react';
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
import { 
    Chart as ChartJS, 
    RadialLinearScale, 
    PointElement, 
    LineElement, 
    Filler, 
    Tooltip, 
    Legend 
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import { MOCK_CANDIDATES, MOCK_STATS, MOCK_ACTIVITY } from '@/lib/mock-data';
import Logo from '@/components/Logo';

// Register ChartJS
ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

// --- Constants & Styles ---
const COLUMNS = [
    { id: 'applied', title: 'New Applied' },
    { id: 'screening', title: 'Screening' },
    { id: 'assessment_sent', title: 'Assessed' },
    { id: 'interview_scheduled', title: 'Interviews' },
    { id: 'hired', title: 'Qualified / Hired' }
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

// --- Mock Components ---

function CandidateCard({ candidate, onClick, isOverlay = false }: { candidate: any, onClick?: (c: any) => void, isOverlay?: boolean }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({
        id: candidate.id,
        data: { type: 'Candidate', candidate }
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
            onClick={() => onClick && onClick(candidate)}
            className={`bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-3 group transition-all hover:border-primary-300 hover:shadow-md cursor-pointer ${isOverlay ? 'shadow-2xl border-primary-400 rotate-2' : ''}`}
        >
            <div className="flex justify-between items-start mb-2">
                <div className="flex-1">
                    <h4 className="font-bold text-gray-900 group-hover:text-primary-600 transition truncate">{candidate.full_name}</h4>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest truncate">{candidate.position_title}</p>
                </div>
                <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-gray-600">
                    <GripVertical className="w-4 h-4" />
                </div>
            </div>

            <div className="flex items-center justify-between mt-4">
                <div className="flex -space-x-2">
                    {candidate.assessment_results?.[0]?.overall_score ? (
                        <div className="w-8 h-8 rounded-full bg-indigo-50 border-2 border-white flex items-center justify-center text-[10px] font-black text-indigo-700 shadow-sm">
                            {candidate.assessment_results[0].overall_score}
                        </div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-50 border-2 border-white flex items-center justify-center text-[10px] font-bold text-gray-300 shadow-sm">
                            ?
                        </div>
                    )}
                </div>
                <div className="text-[10px] text-gray-400 font-medium">
                    {new Date(candidate.applied_at).toLocaleDateString()}
                </div>
            </div>
        </div>
    );
}

function KanbanColumn({ id, title, candidates, onCardClick }: { id: string, title: string, candidates: any[], onCardClick: (c: any) => void }) {
    const { setNodeRef } = useSortable({
        id: id,
        data: { type: 'Column', id }
    });

    return (
        <div className="w-72 flex-shrink-0 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-black text-gray-700 uppercase tracking-widest">{title}</h3>
                    <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {candidates.length}
                    </span>
                </div>
                <button className="text-gray-300 hover:text-gray-600"><MoreHorizontal className="w-4 h-4" /></button>
            </div>
            <div ref={setNodeRef} className="flex-1 bg-gray-50 rounded-2xl p-3 overflow-y-auto no-scrollbar border-2 border-transparent hover:border-gray-200 transition">
                <SortableContext items={candidates.map(c => c.id)} strategy={verticalListSortingStrategy}>
                    {candidates.map(c => (
                        <CandidateCard key={c.id} candidate={c} onClick={onCardClick} />
                    ))}
                </SortableContext>
            </div>
        </div>
    );
}

// --- Detail View Component ---
function CandidateDetailModal({ candidate, onClose }: { candidate: any, onClose: () => void }) {
    if (!candidate) return null;
    const results = candidate.assessment_results?.[0];

    const radarData = results ? {
        labels: ['Openness', 'Conscientiousness', 'Extraversion', 'Agreeableness', 'Neuroticism'],
        datasets: [{
            label: 'Candidate Profile',
            data: [results.personality_data.openness, results.personality_data.conscientiousness, results.personality_data.extraversion, results.personality_data.agreeableness, results.personality_data.neuroticism],
            backgroundColor: 'rgba(79, 70, 229, 0.2)',
            borderColor: 'rgba(79, 70, 229, 1)',
            borderWidth: 2,
        }, {
            label: 'Role Target',
            data: [85, 80, 45, 55, 20],
            backgroundColor: 'rgba(16, 185, 129, 0.05)',
            borderColor: 'rgba(16, 185, 129, 0.4)',
            borderWidth: 2,
            borderDash: [5, 5],
        }]
    } : null;

    return (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-md flex items-center justify-end p-4">
            <div className="bg-white w-full max-w-4xl h-full rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-right duration-500">
                <header className="px-8 py-6 border-b flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
                        <div>
                            <h2 className="text-2xl font-black text-gray-900 tracking-tight">{candidate.full_name}</h2>
                            <p className="text-sm text-gray-500 font-medium">{candidate.position_title} • {candidate.position_department}</p>
                        </div>
                    </div>
                </header>
                <div className="flex-1 overflow-y-auto p-8 space-y-12 no-scrollbar">
                    {/* Insights */}
                    {results && (
                        <div className="bg-primary-900 text-white rounded-3xl p-10 shadow-2xl relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-primary-600 rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2" />
                            <div className="relative z-10 grid md:grid-cols-2 gap-10">
                                <div>
                                    <div className="inline-block px-3 py-1 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-widest text-primary-200 mb-6 border border-white/10">Neuro-Match Result</div>
                                    <h3 className="text-5xl font-black mb-4 tracking-tighter italic">{results.overall_score}% Match</h3>
                                    <p className="text-primary-100/80 leading-relaxed font-medium italic">&quot;{results.summary}&quot;</p>
                                </div>
                                <div className="h-64 flex items-center justify-center bg-white/5 rounded-3xl border border-white/5 p-6 backdrop-blur-sm">
                                    <Radar 
                                        data={radarData!} 
                                        options={{ 
                                            scales: { r: { display: false } }, 
                                            plugins: { legend: { display: false } },
                                            maintainAspectRatio: false 
                                        }} 
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Status</h4>
                            <p className="font-bold text-gray-900 capitalize">{candidate.status}</p>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Source</h4>
                            <p className="font-bold text-gray-900 capitalize">{candidate.source}</p>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Logic Score</h4>
                            <p className="font-bold text-gray-900">{results?.cognitive_data?.logic || 'N/A'}</p>
                        </div>
                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
                            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Resilience</h4>
                            <p className="font-bold text-gray-900">{results?.personality_data?.neuroticism ? (100 - results.personality_data.neuroticism) : 'N/A'}%</p>
                        </div>
                    </div>
                </div>
                <footer className="p-8 border-t bg-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <User className="w-10 h-10 text-gray-300 bg-white p-2 rounded-full border" />
                        <span className="text-sm font-bold text-gray-600">{candidate.email}</span>
                    </div>
                    <button onClick={onClose} className="btn-primary px-10">Close Record</button>
                </footer>
            </div>
        </div>
    );
}

// --- Main Demo Page ---
export default function DemoPage() {
    const [view, setView] = useState<'dashboard' | 'pipeline'>('dashboard');
    const [candidates, setCandidates] = useState(MOCK_CANDIDATES);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const groupedCandidates = useMemo(() => {
        const groups: Record<string, any[]> = {};
        COLUMNS.forEach(col => groups[col.id] = []);
        candidates.forEach(c => {
            const group = STATUS_MAP[c.status] || 'applied';
            if (groups[group]) groups[group].push(c);
        });
        return groups;
    }, [candidates]);

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) return;
        
        let targetStatus = '';
        const overData = over.data.current;
        if (overData?.type === 'Column') targetStatus = overData.id;
        else if (overData?.type === 'Candidate') targetStatus = STATUS_MAP[overData.candidate.status] || 'applied';

        if (targetStatus) {
            setCandidates(prev => prev.map(c => 
                c.id === active.id ? { ...c, status: targetStatus } : c
            ));
        }
    };

    const NavItem = ({ id, icon: Icon, label }: any) => (
        <button 
            onClick={() => setView(id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition font-bold text-sm ${view === id ? 'bg-primary-600 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-900'}`}
        >
            <Icon className="w-5 h-5" />
            {label}
        </button>
    );

    return (
        <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900">
            {/* Sidebar */}
            <aside className="w-72 bg-white border-r h-full flex flex-col p-6 sticky top-0 hidden lg:flex">
                <div className="mb-10 px-2 flex items-center gap-3">
                    <Logo />
                    <div className="bg-primary-100 text-primary-700 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-primary-200">Demo</div>
                </div>
                
                <nav className="flex-1 space-y-2">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 px-4">Talent Management</div>
                    <NavItem id="dashboard" icon={LayoutDashboardIcon} label="Dashboard" />
                    <NavItem id="pipeline" icon={LayoutDashboard} label="Recruitment Pipeline" />
                    <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition font-bold text-sm">
                        <Users className="w-5 h-5" />
                        Positions
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition font-bold text-sm">
                        <Calendar className="w-5 h-5" />
                        Interviews
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition font-bold text-sm">
                        <TrendingUp className="w-5 h-5" />
                        Analytics
                    </button>
                </nav>

                <div className="mt-auto p-4 bg-gray-50 rounded-2xl border border-gray-100">
                    <p className="text-xs font-bold text-gray-800 mb-2">Upgrade for live access</p>
                    <Link href="/auth/register" className="btn-primary w-full py-2 text-[10px] font-black tracking-widest">Get Full Version</Link>
                </div>
            </aside>

            {/* Content Area */}
            <main className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-white border-b px-8 py-5 flex items-center justify-between sticky top-0 z-50">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-black tracking-tight text-gray-900">
                            {view === 'dashboard' ? 'Hiring Overview' : 'Visual Pipeline'}
                        </h2>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="relative hidden md:block">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input className="bg-gray-50 border border-gray-200 rounded-full pl-10 pr-4 py-2 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-64" placeholder="Search talent..." />
                        </div>
                        <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-purple-600 rounded-2xl shadow-lg flex items-center justify-center text-white font-bold text-xs">JD</div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {view === 'dashboard' ? (
                        <>
                            {/* Stats */}
                            <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
                                {Object.entries(MOCK_STATS).map(([key, val]) => (
                                    <div key={key} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm transition hover:shadow-xl hover:scale-105 duration-300">
                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 whitespace-nowrap">{key.replace(/([A-Z])/g, ' $1')}</div>
                                        <div className="text-3xl font-black text-gray-900">{val}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Recent Grid */}
                            <div className="grid lg:grid-cols-3 gap-8">
                                <div className="lg:col-span-2 space-y-6">
                                    <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                                        <Clock className="w-5 h-5 text-primary-600" />
                                        Fastest Growing Talent
                                    </h3>
                                    <div className="grid gap-4">
                                        {candidates.slice(0, 3).map(c => (
                                            <div 
                                                key={c.id} 
                                                onClick={() => setSelectedCandidate(c)}
                                                className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-xl cursor-pointer transition-all group"
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-primary-600 font-black text-lg border border-gray-100 group-hover:bg-primary-50 group-hover:border-primary-100 transition">{c.full_name[0]}</div>
                                                    <div>
                                                        <h4 className="font-black text-gray-900">{c.full_name}</h4>
                                                        <p className="text-xs text-gray-500 font-medium">{c.position_title}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="inline-block px-3 py-1 bg-green-50 text-green-700 text-[10px] font-black rounded-full uppercase tracking-widest border border-green-100">
                                                        {c.assessment_results?.[0]?.overall_score}% Match
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase mt-2">Active now</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-6">
                                    <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                                        <TrendingUp className="w-5 h-5 text-primary-600" />
                                        Activity Hub
                                    </h3>
                                    <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-6 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-primary-100 rounded-full blur-3xl opacity-30 -translate-y-1/2 translate-x-1/2" />
                                        {MOCK_ACTIVITY.map(act => (
                                            <div key={act.id} className="relative pl-6 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-0.5 before:bg-primary-100 last:before:hidden">
                                                <div className="absolute left-[-4px] top-1.5 w-2.5 h-2.5 rounded-full bg-primary-500 border-2 border-white" />
                                                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{act.action.replace(/_/g, ' ')}</h5>
                                                <p className="text-sm font-bold text-gray-800">{act.candidate_name}</p>
                                                <p className="text-[10px] text-gray-400 font-bold italic mt-1">{new Date(act.created_at).toLocaleTimeString()}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCorners}
                            onDragStart={(e) => setActiveId(e.active.id as string)}
                            onDragOver={(e) => {
                                const { active, over } = e;
                                if (!over) return;
                                const activeC = candidates.find(c => c.id === active.id);
                                if (!activeC) return;
                                let targetS = '';
                                const overD = over.data.current;
                                if (overD?.type === 'Column') targetS = overD.id;
                                else if (overD?.type === 'Candidate') targetS = STATUS_MAP[overD.candidate.status] || 'applied';
                                if (targetS && (STATUS_MAP[activeC.status] || 'applied') !== targetS) {
                                    setCandidates(prev => prev.map(c => c.id === active.id ? { ...c, status: targetS } : c));
                                }
                            }}
                            onDragEnd={handleDragEnd}
                        >
                            <div className="flex h-full gap-8 min-w-max pb-8">
                                {COLUMNS.map(column => (
                                    <KanbanColumn 
                                        key={column.id} 
                                        id={column.id} 
                                        title={column.title} 
                                        candidates={groupedCandidates[column.id] || []} 
                                        onCardClick={setSelectedCandidate}
                                    />
                                ))}
                            </div>
                            <DragOverlay>
                                {activeId ? <CandidateCard candidate={candidates.find(c => c.id === activeId)} isOverlay /> : null}
                            </DragOverlay>
                        </DndContext>
                    )}
                </div>
            </main>

            {/* Detail Overlay */}
            {selectedCandidate && (
                <CandidateDetailModal 
                    candidate={selectedCandidate} 
                    onClose={() => setSelectedCandidate(null)} 
                />
            )}

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar { height: 8px; width: 8px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; border: 2px solid transparent; background-clip: content-box; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
                .no-scrollbar::-webkit-scrollbar { display: none; }
            `}</style>
        </div>
    );
}

// Helper icons
function LayoutDashboardIcon(props: any) {
    return <LayoutDashboard {...props} />;
}
function LayoutDashboard(props: any) { // Mock as duplicate for consistency in naming convention in NavItem
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
            <rect width="7" height="9" x="3" y="3" rx="1" />
            <rect width="7" height="5" x="14" y="3" rx="1" />
            <rect width="7" height="9" x="14" y="12" rx="1" />
            <rect width="7" height="5" x="3" y="16" rx="1" />
        </svg>
    )
}
