'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { 
    Users, Briefcase, CheckCircle, Calendar, TrendingUp, Clock, 
    Loader2, Search, 
    Mail, GripVertical, MoreHorizontal, ArrowLeft,
    LayoutDashboard, User, AlertCircle
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

// --- Constants ---
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

// --- Sub-Components ---

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
                {candidates.length === 0 && (
                    <div className="h-24 border-2 border-dashed border-gray-100 rounded-xl flex items-center justify-center text-[10px] text-gray-300 font-bold uppercase tracking-widest">
                        Empty
                    </div>
                )}
            </div>
        </div>
    );
}

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
                                    {radarData && (
                                        <Radar 
                                            data={radarData} 
                                            options={{ 
                                                scales: { r: { display: false } }, 
                                                plugins: { legend: { display: false } },
                                                maintainAspectRatio: false 
                                            }} 
                                        />
                                    )}
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
                    <div className="flex items-center gap-4 text-gray-500">
                        <User className="w-10 h-10 bg-white p-2 rounded-full border" />
                        <span className="text-sm font-bold">{candidate.email}</span>
                    </div>
                    <button onClick={onClose} className="btn-primary px-10">Close Record</button>
                </footer>
            </div>
        </div>
    );
}

// --- Main Demo Page ---
export default function DemoPage() {
    type DemoView = 'dashboard' | 'pipeline' | 'positions' | 'interviews' | 'analytics';
    const [view, setView] = useState<DemoView>('dashboard');
    const [candidates, setCandidates] = useState(MOCK_CANDIDATES);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [selectedCandidate, setSelectedCandidate] = useState<any | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const filteredCandidates = useMemo(() => {
        return candidates.filter(c => 
            c.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.position_title.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [candidates, searchQuery]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const groupedCandidates = useMemo(() => {
        const groups: Record<string, any[]> = {};
        COLUMNS.forEach(col => groups[col.id] = []);
        filteredCandidates.forEach(c => {
            const group = STATUS_MAP[c.status] || 'applied';
            if (groups[group]) groups[group].push(c);
        });
        return groups;
    }, [filteredCandidates]);

    const handleDragOver = (event: DragOverEvent) => {
        const { active, over } = event;
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
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
    };

    const NavItem = ({ id, icon: Icon, label }: { id: DemoView, icon: any, label: string }) => (
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
                    <div className="bg-primary-100 text-primary-700 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-primary-200 shadow-sm">Demo Mode</div>
                </div>
                
                <nav className="flex-1 space-y-1">
                    <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-4 px-4">Talent Management</div>
                    <NavItem id="dashboard" icon={LayoutDashboard} label="Overview" />
                    <NavItem id="pipeline" icon={Users} label="Visual Pipeline" />
                    <NavItem id="positions" icon={Briefcase} label="Positions" />
                    <NavItem id="interviews" icon={Calendar} label="Interviews" />
                    <NavItem id="analytics" icon={TrendingUp} label="Analytics" />
                </nav>

                <div className="mt-auto p-5 bg-primary-900 rounded-3xl text-white relative overflow-hidden group shadow-xl">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary-600 rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2 group-hover:scale-110 transition duration-500" />
                    <p className="text-xs font-bold text-primary-100 mb-3 relative z-10">Start hiring today.</p>
                    <Link href="/auth/register" className="relative z-10 block w-full py-2.5 bg-white text-primary-900 rounded-xl text-center text-[10px] font-black tracking-widest uppercase hover:bg-gray-50 transition shadow-lg">Get Full Version</Link>
                </div>
            </aside>

            {/* Content Area */}
            <main className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-white border-b px-8 py-5 flex items-center justify-between sticky top-0 z-50">
                    <div className="flex items-center gap-4">
                        <h2 className="text-xl font-black tracking-tight text-gray-900 capitalize">
                            {view} 
                            <span className="text-primary-600 ml-2 animate-pulse">•</span>
                        </h2>
                    </div>
                    <div className="flex items-center gap-6">
                        <div className="relative hidden md:block">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input 
                                className="bg-gray-50 border border-gray-200 rounded-full pl-10 pr-4 py-2 text-xs focus:ring-2 focus:ring-primary-500 outline-none w-64 transition-all focus:w-80" 
                                placeholder="Filter demo data..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-purple-600 rounded-2xl shadow-lg flex items-center justify-center text-white font-bold text-xs ring-4 ring-primary-50">JD</div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gray-50/30">
                    {view === 'dashboard' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Stats */}
                            <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-4 mb-10">
                                {Object.entries(MOCK_STATS).map(([key, val]) => (
                                    <div key={key} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm transition hover:shadow-xl hover:-translate-y-1 duration-300">
                                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 whitespace-nowrap">{key.replace(/([A-Z])/g, ' $1')}</div>
                                        <div className="text-3xl font-black text-gray-900 tracking-tighter">{val}</div>
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
                                        {filteredCandidates.slice(0, 3).map(c => (
                                            <div 
                                                key={c.id} 
                                                onClick={() => setSelectedCandidate(c)}
                                                className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-xl cursor-pointer transition-all group lg:pr-8"
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-primary-600 font-black text-lg border border-gray-100 group-hover:bg-primary-600 group-hover:text-white transition-all duration-300">{c.full_name[0]}</div>
                                                    <div>
                                                        <h4 className="font-black text-gray-900 group-hover:text-primary-600 transition">{c.full_name}</h4>
                                                        <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{c.position_title}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="inline-block px-3 py-1 bg-green-50 text-green-700 text-[10px] font-black rounded-full uppercase tracking-widest border border-green-100 group-hover:bg-green-600 group-hover:text-white transition">
                                                        {c.assessment_results?.[0]?.overall_score}% Match
                                                    </div>
                                                    <p className="text-[10px] text-gray-400 font-bold uppercase mt-2 group-hover:text-primary-400">Active now</p>
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
                        </div>
                    )}

                    {view === 'pipeline' && (
                        <div className="h-full animate-in fade-in zoom-in-95 duration-500">
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCorners}
                                onDragStart={(e) => setActiveId(e.active.id as string)}
                                onDragOver={handleDragOver}
                                onDragEnd={handleDragEnd}
                            >
                                <div className="flex h-full gap-8 min-w-max pb-8 overflow-visible">
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
                        </div>
                    )}

                    {view === 'positions' && (
                        <div className="grid gap-6 animate-in slide-in-from-right-4 duration-500">
                            {[
                                { title: 'Senior React Engineer', dept: 'Engineering', apps: 42, score: 92 },
                                { title: 'Product Manager', dept: 'Product', apps: 18, score: 85 },
                                { title: 'Sales Executive', dept: 'Sales', apps: 65, score: 78 }
                            ].map((job, i) => (
                                <div key={i} className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between hover:shadow-xl transition-all group gap-6">
                                    <div className="flex items-center gap-6">
                                        <div className="w-16 h-16 bg-primary-50 rounded-2xl flex items-center justify-center text-primary-600 font-black border border-primary-100 group-hover:bg-primary-600 group-hover:text-white transition duration-500 shadow-sm">
                                            <Briefcase className="w-8 h-8" />
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-black text-gray-900 mb-1 group-hover:text-primary-600 transition">{job.title}</h3>
                                            <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">{job.dept} • {job.apps} Applications</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-8">
                                        <div className="text-right">
                                            <div className="text-2xl font-black text-gray-900 group-hover:text-primary-600 transition">{job.score}%</div>
                                            <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Avg. Quality</div>
                                        </div>
                                        <button className="p-3 bg-gray-50 text-gray-400 rounded-xl hover:bg-primary-50 hover:text-primary-600 transition shadow-inner">
                                            <MoreHorizontal className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {view === 'interviews' && (
                        <div className="space-y-4 animate-in fade-in duration-500">
                            <div className="bg-primary-900 text-white p-8 rounded-3xl shadow-xl mb-8 flex flex-col md:flex-row md:items-center justify-between relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-primary-600 rounded-full blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2 group-hover:scale-125 transition duration-700" />
                                <div className="relative z-10">
                                    <h3 className="text-3xl font-black tracking-tighter italic mb-1">Next Interview in 45m</h3>
                                    <p className="text-primary-100 font-bold uppercase tracking-widest text-[10px]">Sarah Jenkins • Enterprise Sales Role</p>
                                </div>
                                <button onClick={() => alert('Demo Success: Google Meet link generated and calendar invite sent to Sarah Jenkins!')} className="relative z-10 px-8 py-3 bg-white text-primary-900 rounded-2xl font-black tracking-widest text-[10px] uppercase shadow-lg hover:scale-105 active:scale-95 transition-all mt-4 md:mt-0">Launch Meet</button>
                            </div>
                            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-2 overflow-hidden">
                                {[
                                    { name: 'Sarah Jenkins', time: 'Today, 2:00 PM', type: 'Google Meet' },
                                    { name: 'Marcus Thorne', time: 'Tomorrow, 10:00 AM', type: 'Design Review' },
                                    { name: 'David Kim', time: 'Monday, 11:30 AM', type: 'Technical Interview' }
                                ].map((int, i) => (
                                    <div key={i} className="flex items-center justify-between p-6 hover:bg-gray-50 rounded-2xl transition group cursor-pointer">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 border border-gray-100 group-hover:border-primary-100 group-hover:text-primary-600 transition-all shadow-inner">
                                                <Calendar className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-gray-900 group-hover:text-primary-600 transition">{int.name}</h4>
                                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{int.time}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-primary-600 bg-primary-50 px-3 py-1 rounded-full border border-primary-100 shadow-sm group-hover:bg-primary-600 group-hover:text-white transition duration-300">{int.type}</span>
                                            <button className="text-gray-300 hover:text-gray-900 transition"><MoreHorizontal className="w-4 h-4" /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {view === 'analytics' && (
                        <div className="grid lg:grid-cols-2 gap-8 animate-in slide-in-from-bottom-6 duration-700">
                            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm group">
                                <h3 className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-8 flex items-center gap-2 group-hover:text-primary-600 transition">
                                    <TrendingUp className="w-4 h-4" />
                                    Hiring Velocity (Days to Close)
                                </h3>
                                <div className="h-64 flex items-end gap-5 px-4 pb-4">
                                    {[60, 80, 45, 90, 70, 85].map((h, i) => (
                                        <div key={i} className="flex-1 bg-gray-50 rounded-t-2xl relative group/bar hover:bg-primary-100 transition-colors duration-300" style={{ height: `${h}%` }}>
                                            <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] font-black px-3 py-1.5 rounded-lg opacity-0 group-hover/bar:opacity-100 transition-all duration-300 shadow-xl scale-95 group-hover/bar:scale-100 z-10">{h} Days</div>
                                            <div className="h-full w-full bg-primary-600/10 rounded-t-2xl opacity-0 group-hover/bar:opacity-100 transition-opacity" />
                                            <div className="absolute bottom-[-28px] left-1/2 -translate-x-1/2 text-[8px] font-black text-gray-400 uppercase tracking-tighter">Apr-{'0'+(i+1)}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm group">
                                <h3 className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-8 flex items-center gap-2 group-hover:text-primary-600 transition">
                                    <Brain className="w-4 h-4" />
                                    Candidate Quality of Hire
                                </h3>
                                <div className="space-y-8">
                                    {[
                                        { label: 'Technical Match', value: 94, color: 'bg-primary-500' },
                                        { label: 'Culture & Soft Skills', value: 88, color: 'bg-emerald-500' },
                                        { label: 'Longevity Prediction', value: 82, color: 'bg-purple-500' }
                                    ].map((stat, i) => (
                                        <div key={i} className="space-y-3">
                                            <div className="flex justify-between text-xs font-black uppercase tracking-widest text-gray-600">
                                                <span>{stat.label}</span>
                                                <span className="text-gray-900">{stat.value}%</span>
                                            </div>
                                            <div className="h-3 bg-gray-50 rounded-full overflow-hidden border border-gray-100 p-0.5">
                                                <div className={`h-full ${stat.color} rounded-full transition-all duration-1000 shadow-sm`} style={{ width: `${stat.value}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-12 p-5 bg-indigo-50/50 rounded-2xl border border-indigo-100 italic text-sm text-indigo-700 font-medium">
                                    &quot;AI Prediction: Your hiring quality has improved by 24% since implementing Neuro-Matching.&quot;
                                </div>
                            </div>
                        </div>
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
