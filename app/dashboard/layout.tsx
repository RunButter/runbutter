'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { supabase } from '@/lib/supabase';
import {
    Users, Briefcase, Calendar, TrendingUp, LayoutDashboard, Search, Settings, CreditCard, Menu, X, LogOut, Grid, Sparkles, Radio, Heart, Mail, Lock
} from 'lucide-react';
import Logo from '@/components/Logo';
import PlanGate from '@/components/PlanGate';
import { isFeatureAllowed, type PlanFeature } from '@/lib/plans';

const ROUTE_FEATURE: [string, PlanFeature][] = [
    ['/dashboard/treasury', 'talentTreasury'],
    ['/dashboard/sources', 'sourceTracking'],
    ['/dashboard/templates', 'emailTemplates'],
    ['/dashboard/interviews', 'interviews'],
    ['/dashboard/my-team', 'myTeam'],
    ['/dashboard/analytics', 'advancedAnalytics'],
];

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

    const NavItem = ({ href, icon: Icon, label, matchExact = false, feature }: { href: string, icon: any, label: string, matchExact?: boolean, feature?: PlanFeature }) => {
        const isActive = matchExact ? pathname === href : pathname.startsWith(href);
        const locked = feature ? !isFeatureAllowed(company?.plan, feature) : false;
        return (
            <Link
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition font-bold text-sm ${isActive ? 'bg-primary-600 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-900'}`}
            >
                <Icon className="w-5 h-5" />
                <span className="flex-1">{label}</span>
                {locked && <Lock className={`w-3.5 h-3.5 ${isActive ? 'text-white/70' : 'text-gray-300'}`} />}
            </Link>
        );
    };

    if (!ready || !authenticated) {
        return <div className="min-h-screen bg-gray-50" />;
    }

    const requiredFeature = ROUTE_FEATURE.find(([p]) => pathname.startsWith(p))?.[1];

    return (
        <div className="flex h-screen bg-gray-50 overflow-hidden text-gray-900">
            {mobileMenuOpen && (
                <div className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden" onClick={() => setMobileMenuOpen(false)} />
            )}

            <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-white border-r flex-col p-6 lg:static lg:flex ${mobileMenuOpen ? 'flex' : 'hidden'}`}>
                <div className="mb-10 px-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Logo />
                        {company && <div className="bg-primary-100 text-primary-700 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-primary-200 shadow-sm">{company.plan}</div>}
                    </div>
                    <button aria-label="Close menu" className="lg:hidden p-2 -mr-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(false)}>
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <nav className="flex-1 space-y-1 overflow-y-auto no-scrollbar">
                    <Link href="/home" onClick={() => setMobileMenuOpen(false)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-primary-600 to-purple-600 text-white font-bold text-sm shadow-lg hover:from-primary-700 hover:to-purple-700 transition mb-4">
                        <Grid className="w-5 h-5" />
                        <span className="flex-1">Company OS</span>
                        <span className="text-white/80 text-xs">↗</span>
                    </Link>
                    <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-4 px-4 mt-2">HR · Recruitment</div>
                    <NavItem href="/dashboard" icon={LayoutDashboard} label="Overview" matchExact={true} />
                    <NavItem href="/dashboard/pipeline" icon={Grid} label="Visual Pipeline" />
                    <NavItem href="/dashboard/treasury" icon={Sparkles} label="Talent Treasury" feature="talentTreasury" />
                    <NavItem href="/dashboard/candidates" icon={Users} label="All Candidates" />
                    <NavItem href="/dashboard/positions" icon={Briefcase} label="Positions" />
                    <NavItem href="/dashboard/sources" icon={Radio} label="Source Tracking" feature="sourceTracking" />
                    <NavItem href="/dashboard/interviews" icon={Calendar} label="Interviews" feature="interviews" />
                    <NavItem href="/dashboard/analytics" icon={TrendingUp} label="Analytics" feature="advancedAnalytics" />

                    <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-4 px-4 mt-8">Post-Hire</div>
                    <NavItem href="/dashboard/my-team" icon={Heart} label="My Team" feature="myTeam" />

                    <div className="text-[10px] font-black text-gray-300 uppercase tracking-widest mb-4 px-4 mt-8">Organization</div>
                    <NavItem href="/dashboard/templates" icon={Mail} label="Email Templates" feature="emailTemplates" />
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

            <main className="flex-1 flex flex-col overflow-hidden relative">
                <header className="bg-white border-b px-4 lg:px-8 py-5 flex items-center justify-between sticky top-0 z-30">
                    <div className="flex items-center gap-4">
                        <button aria-label="Open menu" className={`p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-lg lg:hidden ${mobileMenuOpen ? 'hidden' : ''}`} onClick={() => setMobileMenuOpen(true)}>
                            <Menu className="w-6 h-6" />
                        </button>
                        <h2 className="text-xl font-black tracking-tight text-gray-900 capitalize flex items-center gap-2">
                            {pathname.split('/').pop() === 'dashboard' ? 'Overview' : pathname.split('/').pop()?.replace(/-/g, ' ')}
                            {(pathname.match(/\//g) || []).length > 2 && <span className="text-xs ml-2 text-gray-400 font-bold tracking-widest uppercase">Details</span>}
                            <span className="text-primary-600 ml-2 animate-pulse hidden md:inline">•</span>
                        </h2>
                    </div>
                    <div className="flex items-center gap-4 lg:gap-6">
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                const q = (e.currentTarget.elements.namedItem('q') as HTMLInputElement).value.trim();
                                if (q) router.push(`/dashboard/candidates?q=${encodeURIComponent(q)}`);
                            }}
                            className="relative hidden xl:block"
                        >
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                name="q"
                                className="bg-gray-50 border border-gray-200 rounded-full pl-10 pr-4 py-2 text-xs w-64 text-gray-700 focus:ring-2 focus:ring-primary-500 focus:bg-white outline-none transition"
                                placeholder="Search candidates & resumes..."
                            />
                        </form>
                        <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-purple-600 rounded-2xl shadow-lg flex items-center justify-center text-white font-bold text-xs ring-4 ring-primary-50 uppercase">
                            {company?.name?.[0] || user?.email?.address?.[0] || 'A'}
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto custom-scrollbar bg-gray-50/30">
                    {company && requiredFeature ? (
                        <PlanGate plan={company.plan} feature={requiredFeature}>{children}</PlanGate>
                    ) : (
                        children
                    )}
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