import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Briefcase, Building2, ArrowRight } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
// Careers pages are read far more than they change, and they must survive a
// burst of traffic from a job post. Revalidate rather than render per request.
export const revalidate = 300;

interface CareersPosition {
  id: string; title: string; department: string | null;
  location: string | null; employment_type: string | null; created_at: string | null;
}
interface CareersPage {
  company: {
    id: string; name: string; slug: string;
    headline: string | null; about: string | null;
    logo_url: string | null; accent_color: string | null; website: string | null;
  };
  positions: CareersPosition[];
}

// Anon EXECUTE is revoked on get_careers_page (0046 convention), so the public
// page reads through the service-role client server-side. The RPC returns only
// what a careers page displays, so there is nothing here a visitor shouldn't see.
async function loadCareers(slug: string): Promise<CareersPage | null> {
  if (!/^[a-z0-9-]{2,40}$/i.test(slug)) return null;
  try {
    const { data, error } = await createAdminClient().rpc('get_careers_page', { p_slug: slug });
    if (error || !data) return null;
    return data as CareersPage;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const page = await loadCareers(params.slug);
  if (!page) return { title: 'Careers' };
  const n = page.positions.length;
  return {
    title: `Careers at ${page.company.name}`,
    description: page.company.headline
      || `${n} open ${n === 1 ? 'role' : 'roles'} at ${page.company.name}.`,
    openGraph: {
      title: `Careers at ${page.company.name}`,
      description: page.company.headline || undefined,
      images: page.company.logo_url ? [page.company.logo_url] : undefined,
    },
    // A careers page exists to be found. Nothing here is private.
    robots: { index: true, follow: true },
  };
}

const prettyType = (t: string | null) => (t || '').replace(/[-_]/g, ' ');

export default async function CareersPage({ params }: { params: { slug: string } }) {
  const page = await loadCareers(params.slug);
  if (!page) notFound();

  const { company, positions } = page;
  // The workspace's brand colour drives the page. Fall back to the product
  // accent rather than rendering an unstyled page when branding is unset.
  const accent = /^#[0-9a-f]{6}$/i.test(company.accent_color || '') ? company.accent_color! : '#4653CE';

  // Group by department so a 40-role page stays scannable; roles with no
  // department fall into one trailing bucket rather than vanishing.
  const groups = new Map<string, CareersPosition[]>();
  for (const p of positions) {
    const key = (p.department || '').trim() || 'Other';
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) =>
    a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b));

  return (
    <main className="min-h-screen bg-surface-sunken" style={{ ['--brand' as any]: accent }}>
      <header className="border-b border-subtle bg-surface">
        <div className="max-w-3xl mx-auto px-5 py-10 sm:py-14">
          <div className="flex items-center gap-3.5">
            {company.logo_url
              ? <img src={company.logo_url} alt="" className="w-12 h-12 rounded-xl object-contain ring-1 ring-subtle bg-surface" />
              : <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-semibold" style={{ background: accent }}>
                  {company.name.slice(0, 1).toUpperCase()}
                </div>}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-tertiary">Careers</p>
              <h1 className="text-xl sm:text-2xl font-semibold text-primary tracking-tight truncate">{company.name}</h1>
            </div>
          </div>

          {company.headline && (
            <p className="mt-5 text-[15px] sm:text-base text-secondary leading-relaxed max-w-2xl">{company.headline}</p>
          )}
          {company.about && (
            <p className="mt-3 text-[13px] text-tertiary leading-relaxed max-w-2xl whitespace-pre-line">{company.about}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full text-white" style={{ background: accent }}>
              <Briefcase className="w-3.5 h-3.5" />
              {positions.length} open {positions.length === 1 ? 'role' : 'roles'}
            </span>
            {company.website && (
              <a href={company.website} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-secondary hover:text-primary">
                <Building2 className="w-3.5 h-3.5" /> Company website
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-8 sm:py-10">
        {positions.length === 0 ? (
          <div className="rounded-xl bg-surface ring-1 ring-subtle p-10 text-center">
            <p className="text-[14px] font-medium text-primary">No open roles right now</p>
            <p className="mt-1.5 text-[13px] text-tertiary">Check back soon — this page updates as new positions open.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {ordered.map(([dept, roles]) => (
              <section key={dept}>
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-tertiary mb-2.5">{dept}</h2>
                <ul className="space-y-2">
                  {roles.map((p) => (
                    <li key={p.id}>
                      <Link href={`/apply/${p.id}`}
                        className="group flex items-center gap-4 rounded-xl bg-surface ring-1 ring-subtle hover:ring-strong shadow-sm hover:shadow-card transition-all px-4 py-3.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-primary truncate">{p.title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-tertiary">
                            {p.location && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {p.location}</span>}
                            {p.employment_type && <span className="capitalize">{prettyType(p.employment_type)}</span>}
                          </div>
                        </div>
                        <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold group-hover:gap-1.5 transition-all" style={{ color: accent }}>
                          Apply <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-tertiary">
          Powered by <a href="https://runbutter.app" className="hover:text-secondary underline underline-offset-2">RunButter</a>
        </p>
      </div>
    </main>
  );
}
