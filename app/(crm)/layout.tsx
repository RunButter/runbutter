import NavRail from '@/components/crm/NavRail';

// App shell for the Business-OS workspace. The marketing site and the legacy
// /dashboard keep their own layouts; this is the new Twenty-style surface.
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-white text-slate-900">
      <NavRail />
      <main className="flex-1 flex flex-col overflow-hidden">{children}</main>
    </div>
  );
}
