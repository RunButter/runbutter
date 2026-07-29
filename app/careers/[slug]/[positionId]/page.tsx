import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase';
import JobDetail, { jobPostingJsonLd, type JobPageData } from '@/components/careers/JobDetail';

export const runtime = 'nodejs';
// Short window, like the careers index: hiding a role must take effect quickly,
// and publish/hide also purges these paths via /api/careers/revalidate.
export const revalidate = 30;

// get_careers_position returns null for a role that is hidden, closed, or not
// this company's — so an unlisted role cannot be reached by guessing its id.
async function loadJob(slug: string, positionId: string): Promise<JobPageData | null> {
  if (!/^[a-z0-9-]{2,40}$/i.test(slug)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(positionId)) return null;
  try {
    const { data, error } = await createAdminClient()
      .rpc('get_careers_position', { p_slug: slug, p_position: positionId });
    if (error || !data) return null;
    return data as JobPageData;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: { slug: string; positionId: string } },
): Promise<Metadata> {
  const job = await loadJob(params.slug, params.positionId);
  if (!job) return { title: 'Position not found' };
  const { company, position } = job;
  const where = [position.department, position.location].filter(Boolean).join(' · ');
  return {
    title: `${position.title} — ${company.name}`,
    description: (position.description || `${position.title} at ${company.name}${where ? ` (${where})` : ''}.`)
      .replace(/\s+/g, ' ').slice(0, 200),
    openGraph: {
      title: `${position.title} — ${company.name}`,
      type: 'article',
      images: company.og_image_url ? [company.og_image_url]
        : company.cover_image_url ? [company.cover_image_url]
        : company.logo_url ? [company.logo_url] : undefined,
    },
    icons: company.favicon_url ? { icon: company.favicon_url } : undefined,
    robots: { index: true, follow: true },
  };
}

export default async function JobRoute({ params }: { params: { slug: string; positionId: string } }) {
  const job = await loadJob(params.slug, params.positionId);
  if (!job) notFound();

  const canonical = `https://runbutter.app/careers/${job.company.slug}/${job.position.id}`;

  return (
    <>
      <script
        type="application/ld+json"
        // Built server-side from our own database, so there is no
        // user-controlled script context here; JSON.stringify is the escaping.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingJsonLd(job, canonical)) }}
      />
      <JobDetail job={job} />
    </>
  );
}
