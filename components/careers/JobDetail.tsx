import Link from 'next/link';
import { MapPin, Briefcase, ArrowLeft, ArrowRight, Building2, Clock } from 'lucide-react';

export interface JobPageData {
  company: {
    id: string; name: string; slug: string;
    logo_url: string | null; accent_color: string | null; website: string | null;
    cover_image_url: string | null; favicon_url: string | null; og_image_url: string | null;
    apply_intro: string | null;
  };
  position: {
    id: string; title: string; description: string | null;
    department: string | null; location: string | null;
    employment_type: string | null; created_at: string | null;
  };
  other_positions: { id: string; title: string; department: string | null; location: string | null }[];
}

const prettyType = (t: string | null) => (t || '').replace(/[-_]/g, ' ');

// schema.org JobPosting -> eligibility for Google Jobs. Only expressible because
// each role now has its own URL. Fields we don't genuinely hold (salary,
// validThrough) are omitted rather than guessed — absent beats wrong.
export function jobPostingJsonLd(job: JobPageData, url: string) {
  const { company, position } = job;
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: position.title,
    description: position.description || position.title,
    datePosted: position.created_at || undefined,
    directApply: true,
    url,
    employmentType: position.employment_type
      ? position.employment_type.toUpperCase().replace(/[^A-Z]/g, '_')
      : undefined,
    hiringOrganization: {
      '@type': 'Organization',
      name: company.name,
      sameAs: company.website || undefined,
      logo: company.logo_url || undefined,
    },
    jobLocation: position.location
      ? { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: position.location } }
      : undefined,
  };
}

/** Presentation only — the route does the fetching and the 404. */
export default function JobDetail({ job }: { job: JobPageData }) {
  const { company, position, other_positions: others } = job;
  const accent = /^#[0-9a-f]{6}$/i.test(company.accent_color || '') ? company.accent_color! : '#4653CE';

  return (
    <main className="min-h-screen bg-surface-sunken">
      <header className="bg-surface border-b border-subtle">
        {company.cover_image_url && (
          <div className="w-full h-32 sm:h-44 overflow-hidden bg-surface-sunken">
            <img src={company.cover_image_url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="max-w-3xl mx-auto px-5 py-8 sm:py-10">
          <Link href={`/careers/${company.slug}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-tertiary hover:text-secondary mb-5">
            <ArrowLeft className="w-3.5 h-3.5" /> All roles at {company.name}
          </Link>

          <div className="flex items-start gap-3.5">
            {company.logo_url
              ? <img src={company.logo_url} alt="" className="w-11 h-11 rounded-xl object-contain ring-1 ring-subtle bg-surface shrink-0" />
              : <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-base font-semibold shrink-0" style={{ background: accent }}>
                  {company.name.slice(0, 1).toUpperCase()}
                </div>}
            <div className="min-w-0">
              <p className="text-xs font-medium text-tertiary">{company.name}</p>
              <h1 className="text-xl sm:text-3xl font-semibold text-primary tracking-tight">{position.title}</h1>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-secondary">
            {position.department && (
              <span className="inline-flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5 text-tertiary" /> {position.department}</span>
            )}
            {position.location && (
              <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-tertiary" /> {position.location}</span>
            )}
            {position.employment_type && (
              <span className="inline-flex items-center gap-1.5 capitalize"><Clock className="w-3.5 h-3.5 text-tertiary" /> {prettyType(position.employment_type)}</span>
            )}
          </div>

          <Link href={`/apply/${position.id}`}
            className="mt-6 inline-flex items-center gap-2 h-11 px-5 rounded-xl text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
            style={{ background: accent }}>
            Apply for this role <ArrowRight className="w-4 h-4" />
          </Link>
          {company.apply_intro && (
            <p className="mt-2.5 text-xs text-tertiary max-w-lg">{company.apply_intro}</p>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-8 sm:py-10 space-y-8">
        <section className="card-surface p-6 sm:p-8">
          <h2 className="text-base font-semibold text-primary mb-3">About this role</h2>
          {position.description?.trim() ? (
            // Descriptions are plain text today, so preserve the author's line
            // breaks instead of collapsing everything into one block.
            <div className="text-base text-secondary leading-relaxed whitespace-pre-line">
              {position.description}
            </div>
          ) : (
            <p className="text-sm text-tertiary">
              No description was added for this role. Apply and we’ll be in touch with the details.
            </p>
          )}
        </section>

        <section className="rounded-xl p-6 text-center ring-1 ring-subtle bg-surface">
          <p className="text-base font-medium text-primary">Interested?</p>
          <p className="mt-1 text-sm text-tertiary">Takes a few minutes — CV plus a short assessment.</p>
          <Link href={`/apply/${position.id}`}
            className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold text-white hover:opacity-90"
            style={{ background: accent }}>
            Apply now <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </section>

        {others.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-primary mb-2.5">
              Other open roles
            </h2>
            <ul className="space-y-2">
              {others.map((o) => (
                <li key={o.id}>
                  <Link href={`/careers/${company.slug}/${o.id}`}
                    className="group flex items-center gap-4 rounded-xl bg-surface ring-1 ring-subtle hover:ring-strong shadow-sm hover:shadow-card transition-all px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-primary truncate">{o.title}</p>
                      <p className="text-2xs text-tertiary truncate">
                        {[o.department, o.location].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0 text-tertiary group-hover:text-secondary" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-center text-2xs text-tertiary">
          {company.website && (
            <>
              <a href={company.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-secondary">
                <Building2 className="w-3 h-3" /> {company.name}
              </a>
              {' · '}
            </>
          )}
          Powered by <a href="https://runbutter.app" className="hover:text-secondary underline underline-offset-2">RunButter</a>
        </p>
      </div>
    </main>
  );
}

