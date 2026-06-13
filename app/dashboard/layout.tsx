'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import { 
    Users, Briefcase, Calendar, TrendingUp, LayoutDashboard, Search, Settings, CreditCard, Menu, X, LogOut, Grid, Sparkles
} from 'lucide-react';
import Logo from '@/components/Logo';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, ready, authenticated, logout } = usePrivy();
    const [company, setCompany] = useState<any>(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        if (ready && authenticated && user) {
            loadCompanyData();
        }
    }, [ready, authenticated, user]);

    async function loadCompanyData() {
        try {
            await supabase.rpc('set_config', { name: 'app.current_privy_user_id', value: user!.id, is_local: false });
            const { data } = await supabase.from('company_users').select('*, company:companies(*)').eq('privy_user_id', user!.id).single();
            if (data?.company) setCompany(data.company);
        } catch (e) {
            console.error('Error loading company data in layout');
        }
    }

    const NavItem = ({ href, icon: Icon, label, matchExact = false }: { href: string, icon: any, label: string, matchExact?: boolean }) => {
        const isActive = matchExact ? pathname === href : pathname.startsWith(href);
        return (
            <Link 
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition font-bold text-sm ${isActive ? 'bg-primary-600 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-900'}`}
            >
                <Icon className="w-5 h-5" />
                {label}
            </Link>
        );
    };

    if (!ready || !authenticated) {
        // Will be redirected by inner pages or can just render empty until redirect
        return <div className="min-h-screen bg-gray-50" />; 
    }

    return (
        <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900">
            {/* Mobile menu toggle */}
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden" onClick={() => setMobileMenuOpen(false)} />
            )}

            {/* Sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-white border-r flex flex-col p-6 transition-transform duration-300 lg:static lg:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="mb-10 px-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Logo />
                        {company && <div className="bg-primary-100 text-primary-700 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-primary-200 shadow-sm">{company.plan}</div>}
                    </div>
                    <button className="lg:hidden p-2 text-gray-500" onClick={() => setMobileMenuOpen(false)}>
                        <X className="w-5 h-5" />
                    </button>
                </div>
                
                <nav className="flex-1 space-y-1 overflow-y-auto no-scrollbar">
                    <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-4 px-4 mt-2">Talent Management</div>
                    <NavItem href="/dashboard" icon={LayoutDashboard} label="Overview" matchExact={true} />
                    <NavItem href="/dashboard/pipeline" icon={Grid} label="Visual Pipeline" />
                    <NavItem href="/dashboard/treasury" icon={Sparkles} label="Talent Treasury" />
                    <NavItem href="/dashboard/candidates" icon={Users} label="All Candidates" />
                    <NavItem href="/dashboard/positions" icon={Briefcase} label="Positions" />
                    <NavItem href="/dashboard/interviews" icon={Calendar} label="Interviews" />
                    <NavItem href="/dashboard/analytics" icon={TrendingUp} label="Analytics" />
                    
                    <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-4 px-4 mt-8">Organization</div>
                    <NavItem href="/dashboard/settings" icon={Settings} label="Settings" />
                    <NavItem href="/dashboard/billing" icon={CreditCard} label="Billing" />
                </nav>

                <div className="mt-4 pt-4 border-t">
                    <button 
                        onClick={async () => {
                            await logout();
                            router.push('/auth/login');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-400 hover:bg-red-50 hover:text-red-600 transition font-bold text-sm"
                    >
                        <LogOut className="w-5 h-5" />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Content Area */}
            <main className="flex-1 flex flex-col overflow-hidden relative">
                <header className="bg-white border-b px-4 lg:px-8 py-5 flex items-center justify-between sticky top-0 z-30">
                    <div className="flex items-center gap-4">
                        <button className="lg:hidden p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(true)}>
                            <Menu className="w-6 h-6" />
                        </button>
                        <h2 className="text-xl font-black tracking-tight text-gray-900 capitalize flex items-center gap-2">
                            {pathname.split('/').pop() === 'dashboard' ? 'Overview' : pathname.split('/').pop()?.replace(/-/g, ' ')}
                            {(pathname.match(/\//g) || []).length > 2 && <span className="text-xs ml-2 text-gray-400 font-bold tracking-widest uppercase">Details</span>}
                            <span className="text-primary-600 ml-2 animate-pulse hidden md:inline">•</span>
                        </h2>
                    </div>
                    <div className="flex items-center gap-4 lg:gap-6">
                        <div className="relative hidden xl:block">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input 
                                className="bg-gray-50 border border-gray-200 rounded-full pl-10 pr-4 py-2 text-xs w-64 text-gray-400 cursor-not-allowed" 
                                placeholder="Global search (Coming soon)..." 
                                disabled
                            />
                        </div>
                        <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-purple-600 rounded-2xl shadow-lg flex items-center justify-center text-white font-bold text-xs ring-4 ring-primary-50 uppercase">
                            {company?.name?.[0] || user?.email?.address?.[0] || 'A'}
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto custom-scrollbar bg-gray-50/30">
                    {children}
                </div>
            </main>

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
