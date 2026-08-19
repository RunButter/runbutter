import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import { listPublishedStyles } from '@/lib/design/library-server';
import { PRESETS } from '@/lib/design/presets';
import { SITE_URL } from '@/lib/site';

/**
 * Styles people published.
 *
 * ── ITS OWN PAGE, NOT A STRIP ON /brand ─────────────────────────────────────
 * /brand is static and fast, and its job is to be a crawlable answer to "what
 * does a DESIGN.md look like". Reading the library there would make the whole
 * page dynamic — a database round trip on every visit — to show a strip most
 * visitors scroll past. This one is dynamic because it has to be, and it is the
 * page that grows.
 *
 * ── EVERY CARD LINKS, WHICH IS HOW THEY GET FOUND ───────────────────────────
 * The sitemap lists the six built-ins and this page; published styles are
 * discovered by following links from here, which is what crawlers do and what
 * a build-time sitemap of database rows could never keep current.
 */

const TITLE = 'Design systems people published';
const DESCRIPTION =
  'A public library of DESIGN.md specs — colours, typography levels, spacing, components and rules, free to copy into Claude Code, Cursor or Copilot. Published by the people who made them.';

export const metadata: Metadata = {
  title: `${TITLE} — RunButter`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/brand/library` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/brand/library`, type: 'website' },
};

// The library changes when somebody publishes, and a stale gallery is a page
// that quietly stops rewarding the person who just contributed to it.
export const revalidate = 300;

export default async function LibraryPage() {
  const styles = await listPublishedStyles(120);

  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />

      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 pt-24 md:pt-28 pb-12">
          <Link href="/brand" className="text-2xs font-mono text-tertiary hover:text-primary">← the builder</Link>
          <h1 className="mt-3 text-4xl md:text-5xl font-medium tracking-[-0.03em] leading-[1.05]">
            Design systems<br /><span className="text-secondary">people published.</span>
          </h1>
          <p className="mt-5 text-base md:text-lg text-secondary leading-relaxed max-w-xl">
            Complete DESIGN.md specs — colours with roles, typography levels with weight and tracking,
            spacing, components and the rules. Free to copy into Claude Code, Cursor or Copilot.
          </p>
          <p className="mt-3 text-sm text-tertiary">
            Made one?{' '}
            <Link href="/brand" className="text-primary hover:underline">Build it here</Link>{' '}
            and publish it from your workspace.
          </p>
        </div>
      </section>

      {styles.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12 md:py-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {styles.map((s) => {
              const at = (n: string) => s.colors.find((c) => c.name === n)?.hex;
              const bg = at('background') || '#FFFFFF';
              const fg = at('foreground') || '#111111';
              return (
                <Link key={s.slug} href={`/brand/style/${s.slug}`}
                  className="rounded-xl ring-1 ring-subtle overflow-hidden bg-surface hover:ring-strong transition-shadow">
                  <div style={{ background: bg, padding: '20px 18px 18px' }}>
                    <div style={{
                      fontFamily: s.heading ? `"${s.heading}", sans-serif` : 'system-ui, sans-serif',
                      fontSize: 24, lineHeight: 1.05, color: fg, fontWeight: 600,
                    }}>{s.name}</div>
                    {s.essence && (
                      <div style={{
                        fontFamily: s.body ? `"${s.body}", sans-serif` : 'system-ui, sans-serif',
                        fontSize: 12.5, color: at('muted') || '#6B7280', marginTop: 6, lineHeight: 1.5,
                      }}>{s.essence}</div>
                    )}
                    <div style={{ display: 'flex', gap: 4, marginTop: 14 }}>
                      {s.colors.slice(0, 7).map((c, i) => (
                        <span key={`${c.name}-${i}`} style={{
                          width: 16, height: 16, borderRadius: 4, background: c.hex,
                          boxShadow: 'inset 0 0 0 1px rgb(128 128 128 / 0.22)',
                        }} />
                      ))}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    {s.blurb && <p className="text-2xs text-secondary leading-snug line-clamp-2">{s.blurb}</p>}
                    <p className="mt-1.5 text-3xs text-tertiary font-mono truncate">
                      {s.group_key}
                      {s.author ? ` · ${s.author}` : ''}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* An empty library says so and points somewhere useful. A page that
          renders a blank grid reads as broken rather than as new. */}
      {styles.length === 0 && (
        <section className="max-w-6xl mx-auto px-6 py-12 md:py-16">
          <div className="rounded-2xl ring-1 ring-subtle bg-surface-sunken p-8 text-center">
            <p className="text-base text-secondary">Nobody has published one yet.</p>
            <p className="mt-2 text-sm text-tertiary max-w-md mx-auto">
              The six styles that ship with the builder are below — or build your own from a logo and
              publish it, and this is where it lands.
            </p>
            <Link href="/brand"
              className="mt-5 inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90">
              Open the builder <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      )}

      <section className="border-t border-subtle bg-surface-sunken">
        <div className="max-w-6xl mx-auto px-6 py-14 md:py-20">
          <h2 className="text-2xl font-medium tracking-tight">The ones that ship with it</h2>
          <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PRESETS.map((p) => (
              <Link key={p.id} href={`/brand/style/${p.id}`}
                className="rounded-xl ring-1 ring-subtle bg-surface p-4 hover:ring-strong transition-shadow">
                <div className="text-sm font-medium text-primary">{p.label}</div>
                <div className="mt-1 text-2xs text-secondary leading-snug">{p.essence}</div>
                <div className="mt-2.5 flex gap-1">
                  {p.tokens.colors.slice(0, 7).map((c) => (
                    <span key={c.name} className="w-4 h-4 rounded" style={{ background: c.hex, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.08)' }} />
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
