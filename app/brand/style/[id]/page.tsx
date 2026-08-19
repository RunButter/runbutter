import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import FormatTabs from '@/components/design/FormatTabs';
import StyleHero from '@/components/design/StyleHero';
import { PRESETS, findPreset, type Preset } from '@/lib/design/presets';
import { getPublishedStyle } from '@/lib/design/library-server';
import { SITE_URL } from '@/lib/site';

/**
 * One style, one URL.
 *
 * ── STATIC, AND GENERATED FROM THE SAME ARRAY THE BUILDER USES ──────────────
 * `generateStaticParams` reads `PRESETS`, so adding a style adds a page, a
 * sitemap entry and a gallery card at once. A hand-kept list of routes goes
 * stale silently and then advertises 404s, which is worse than having none —
 * the same rule the docs sitemap follows.
 *
 * Everything a reader needs is in the HTML: the description, the palette, the
 * type levels and the rules. A page whose content only appears after a click is
 * useless to every crawler and every answer engine, and those are exactly who
 * is being asked "what should my DESIGN.md look like".
 */

export function generateStaticParams() {
  return PRESETS.map((p) => ({ id: p.id }));
}

// Published styles are rendered on demand and cached. `dynamicParams` is the
// default, and it is what lets one URL space hold both the six that ship and
// everything the library grows — `reserved_design_slug` is why a published
// style can never claim a built-in's URL.
export const revalidate = 300;

/**
 * A built-in first, then the library.
 *
 * That ORDER is the safety property, and it is the same one the CRUD monolith
 * uses for custom objects: a curated style can never be shadowed by something
 * somebody published, whatever they called it.
 */
async function resolve(id: string): Promise<Preset | null> {
  const built = findPreset(id);
  if (built) return built;
  const row = await getPublishedStyle(id);
  if (!row) return null;
  return {
    id: row.slug,
    label: row.name,
    group: (['Product', 'Marketing', 'Editorial', 'Studio'].includes(row.group_key)
      ? row.group_key : 'Studio') as Preset['group'],
    blurb: row.blurb || '',
    essence: row.essence || '',
    tokens: row.tokens,
    published: { author: row.author, authorUrl: row.author_url, at: row.created_at },
  };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const p = await resolve(params.id);
  if (!p) return { title: 'Style not found — RunButter' };
  const title = `${p.label} — a free DESIGN.md style`;
  const description = `${p.essence} ${p.blurb} Copy the DESIGN.md, Tailwind v4 theme, CSS variables and design.json — free, no account.`;
  return {
    title: `${title} — RunButter`,
    description,
    alternates: { canonical: `${SITE_URL}/brand/style/${p.id}` },
    openGraph: { title, description, url: `${SITE_URL}/brand/style/${p.id}`, type: 'article' },
  };
}

export default async function StylePage({ params }: { params: { id: string } }) {
  const preset = await resolve(params.id);
  if (!preset) notFound();
  const t = preset.tokens;
  const others = PRESETS.filter((p) => p.id !== preset.id).slice(0, 3);
  const pub = preset.published;

  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />

      <section className="border-b border-subtle">
        <div className="max-w-6xl mx-auto px-6 pt-24 md:pt-28 pb-8">
          <Link href="/brand" className="text-2xs font-mono text-tertiary hover:text-primary">← all styles</Link>
          {/* The metaphor first, at headline size. A style is a FEELING before
              it is a token list, and somebody deciding whether this is theirs
              decides on that line rather than on the hex codes. */}
          <p className="mt-4 text-2xs font-mono uppercase tracking-widest text-tertiary">
            {preset.group}{pub && ' · published'}
          </p>
          <h1 className="mt-2 text-4xl md:text-5xl font-medium tracking-[-0.03em] leading-[1.05]">{preset.label}</h1>
          <p className="mt-4 text-xl md:text-2xl text-secondary leading-snug max-w-2xl">{preset.essence}</p>
          <p className="mt-4 text-sm text-tertiary leading-relaxed max-w-2xl">{t.brand.description}</p>
          {pub?.author && (
            <p className="mt-3 text-sm text-tertiary">
              by{' '}
              {pub.authorUrl
                // nofollow ugc: the ONE field on this page that becomes a link,
                // and it was typed by whoever published. A dofollow link from an
                // indexed page is the payload every spam submission is after.
                ? <a href={pub.authorUrl} target="_blank" rel="nofollow ugc noopener noreferrer" className="text-secondary hover:underline">{pub.author}</a>
                : <span className="text-secondary">{pub.author}</span>}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-1.5">
            {[
              ...[t.type.heading, t.type.body].filter(Boolean) as string[],
              `${t.type.levels?.length ?? 0} type levels`,
              t.elevation.length ? `${t.elevation.length} shadows` : 'no shadows',
              `${t.colors.length} colours`,
              `radius ${t.radius.map((r) => r.px).filter((x) => x < 999).join('/')}`,
            ].map((x) => (
              <span key={x} className="text-3xs font-mono text-tertiary bg-surface-sunken ring-1 ring-subtle rounded px-2 py-1">{x}</span>
            ))}
          </div>
        </div>
      </section>

      {/* The style, drawn at full width from its own tokens — the closest thing
          to a screenshot that cannot go out of date, because it IS the spec
          rendering rather than a picture of one. */}
      <StyleHero preset={preset} />

      <section className="max-w-6xl mx-auto px-6 py-10 md:py-14">
        <FormatTabs tokens={t} />
        <div className="mt-6">
          <Link href={`/brand?style=${preset.id}`}
            className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90">
            Make it yours <ArrowRight className="w-4 h-4" />
          </Link>
          <span className="ml-3 text-2xs text-tertiary">Opens in the builder — swap the colours, drop in your logo, keep the rest.</span>
        </div>
      </section>

      {/* The rules, in the HTML rather than only inside the code block: they are
          the half of a brand spec people come here to read, and a <pre> is not
          where a reader looks for an argument. */}
      <section className="border-t border-subtle bg-surface-sunken">
        <div className="max-w-6xl mx-auto px-6 py-14 md:py-20 grid lg:grid-cols-2 gap-10 lg:gap-16">
          <div>
            <h2 className="text-2xl font-medium tracking-tight">How it is meant to be used</h2>
            <ul className="mt-5 space-y-2.5">
              {t.rules.do.map((r) => (
                <li key={r} className="text-sm text-secondary leading-relaxed">{r}</li>
              ))}
            </ul>
            {!!t.voice.tone?.length && (
              <p className="mt-6 text-sm text-secondary leading-relaxed">
                <b className="text-primary">Voice</b> — {t.voice.tone.join(', ')}.
                {!!t.voice.weNeverSay?.length && ` Never: ${t.voice.weNeverSay.join(', ')}.`}
              </p>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-medium tracking-tight">Never</h2>
            <ul className="mt-5 space-y-2.5">
              {t.rules.dont.map((r) => (
                <li key={r} className="text-sm text-secondary leading-relaxed">{r}</li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-tertiary leading-relaxed">
              The don&apos;t list is last in the file and blunt on purpose. A constraint buried
              mid-document is one an agent averages against everything else it read.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-14 md:py-20">
          <h2 className="text-2xl font-medium tracking-tight">Other styles</h2>
          <div className="mt-5 grid sm:grid-cols-3 gap-3">
            {others.map((p) => (
              <Link key={p.id} href={`/brand/style/${p.id}`}
                className="rounded-xl ring-1 ring-subtle bg-surface p-4 hover:ring-strong transition-shadow">
                <div className="text-sm font-medium text-primary">{p.label}</div>
                <div className="mt-1 text-2xs text-secondary leading-snug">{p.essence}</div>
                <div className="mt-2.5 flex gap-1">
                  {p.tokens.colors.slice(0, 6).map((c) => (
                    <span key={c.name} className="w-4 h-4 rounded" style={{ background: c.hex, boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / 0.08)' }} />
                  ))}
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-8">
            <Link href="/brand"
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90">
              Build your own from a logo <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
