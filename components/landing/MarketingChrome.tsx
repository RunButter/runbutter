import Link from 'next/link';
import { Star, ArrowUpRight } from 'lucide-react';
import { Github } from '@/components/ui/BrandIcons';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ui/ThemeToggle';

export const REPO_URL = 'https://github.com/RunButter/runbutter';

/**
 * The marketing header and footer, shared by the landing page and every other
 * public page that is not a legal document.
 *
 * `home` exists because the section links are hash anchors INTO the landing
 * page. On the landing page `#pricing` is correct; anywhere else it scrolls to
 * nothing, so it has to be `/#pricing`. That one difference is the only reason
 * this takes a prop.
 */
export function MarketingHeader({ home = false }: { home?: boolean }) {
  const at = (hash: string) => (home ? hash : `/${hash}`);
  return (
    <header className="sticky top-0 z-50 border-b border-subtle bg-canvas/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/"><Logo mono /></Link>
        <nav className="flex items-center gap-2 md:gap-6 text-sm text-secondary">
          <Link href={at('#features')} className="hidden md:inline hover:text-primary transition-colors">Features</Link>
          <Link href="/ai-agents" className="hidden md:inline hover:text-primary transition-colors">Agents</Link>
          <Link href="/developers" className="hidden md:inline hover:text-primary transition-colors">Docs</Link>
          <Link href={at('#pricing')} className="hidden md:inline hover:text-primary transition-colors">Pricing</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 hover:text-primary transition-colors"><Github className="w-4 h-4" /> GitHub</a>
          <ThemeToggle />
          <Link href="/auth/register" className="inline-flex items-center h-8 px-3 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">Start free</Link>
        </nav>
      </div>
      {/* Reading progress. Scroll-driven CSS only — no listener, no rAF, no
          state — so it costs nothing on the main thread and cannot jank the
          scroll it is measuring. Browsers without animation-timeline get no
          bar rather than a JS fallback: it is decoration, and a scroll handler
          on every public page is a real cost to pay for one. */}
      <div aria-hidden="true" className="scroll-progress" />
    </header>
  );
}

// ── Community ───────────────────────────────────────────────────────────────
/**
 * Only accounts that EXIST belong here. A footer row of eight icons where five
 * lead to a 404 (or, worse, to a squatted handle) costs more trust than the
 * empty space it filled, and it is the first thing someone checks when deciding
 * whether a project is alive. Fill a URL in and the icon appears; leave it empty
 * and nothing renders.
 *
 * These are plain SVG paths rather than an icon dependency because lucide is a
 * UI icon set and deliberately does not ship brand marks.
 */
const SOCIALS: { name: string; href: string; path: string }[] = [
  { name: 'GitHub', href: REPO_URL, path: 'M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3' },
  // A maintainer's personal account, deliberately. Early open source is a
  // person, not a brand, and a real account someone can reply to is worth more
  // than a blank space held for a company handle that does not exist yet.
  // Swap it for a project account whenever there is one.
  { name: 'X', href: 'https://x.com/hermescryptos', path: 'M18.9 1.2h3.7l-8 9.1L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.2h7.6l5.2 6.9zm-1.3 19.4h2L6.5 3.3H4.3z' },
  // Create the account, paste the URL, done. No placeholder links.
  { name: 'Discord', href: '', path: 'M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.4a18 18 0 0 1 4.4 1.4 15.5 15.5 0 0 0-13.2 0A18 18 0 0 1 10.8 3.4L10.6 3a19.8 19.8 0 0 0-4.9 1.4C2.6 9 1.7 13.5 2.2 17.9a19.9 19.9 0 0 0 6 3l1.2-1.7a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a13 13 0 0 1-2 1l1.2 1.7a19.9 19.9 0 0 0 6-3c.6-5.1-.8-9.6-3.5-13.5M8.7 15.3c-1.2 0-2.1-1.1-2.1-2.4S7.5 10.5 8.7 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4m6.6 0c-1.2 0-2.1-1.1-2.1-2.4s1-2.4 2.1-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4' },
  { name: 'LinkedIn', href: '', path: 'M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1a3.8 3.8 0 0 1 3.4-1.9c3.6 0 4.3 2.4 4.3 5.5zM5.3 7.4a2.1 2.1 0 1 1 2.1-2.1 2.1 2.1 0 0 1-2.1 2.1m1.8 13.1H3.5V9h3.6zM22.2 0H1.8A1.8 1.8 0 0 0 0 1.8v20.4A1.8 1.8 0 0 0 1.8 24h20.4a1.8 1.8 0 0 0 1.8-1.8V1.8A1.8 1.8 0 0 0 22.2 0' },
];

/**
 * Live star count, fetched ON THE SERVER and cached for an hour.
 *
 * Deliberately not a browser fetch. `connect-src` in next.config.js does not
 * include api.github.com, so a client-side call would be reported today and
 * blocked the moment that policy is enforced — and it would send every
 * visitor's IP to GitHub to render a number. One request an hour per instance
 * costs nothing and stays inside `'self'`.
 *
 * Returns null on any failure and the button renders without a count, because
 * a build that breaks when GitHub has a bad minute is not worth a badge.
 */
async function starCount(): Promise<number | null> {
  try {
    const res = await fetch('https://api.github.com/repos/RunButter/runbutter', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'runbutter.app' },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.stargazers_count === 'number' ? json.stargazers_count : null;
  } catch {
    return null;
  }
}

// ── Product Hunt ────────────────────────────────────────────────────────────
/**
 * The launch badge. BOTH VALUES ARE COPIED VERBATIM from the snippet Product
 * Hunt hands you — neither is constructed, and that is the whole point.
 *
 * The first version built the link itself, as `/posts/<slug>#<post_id>`, which
 * is the URL shape every Product Hunt badge used for years. It now 302s to a
 * `/products/<slug>?…&launch=<slug>` URL that returns a 512 after rendering
 * for about a second. Nothing about that is our bug and nothing about it is
 * fixable from here; the canonical `/products/<slug>/launches/<slug>` address
 * in their own snippet just works. Guessing another vendor's URL scheme buys
 * nothing and breaks the moment they reorganise their routes.
 *
 * Note also that a Product Hunt PRODUCT id and a LAUNCH POST id are different
 * numbers with near-identical embed snippets, and putting one where the other
 * belongs renders a broken image rather than raising anything. This is the post
 * id, from `featured.svg?post_id=`.
 *
 * Defaulted rather than required, the same way REPO_URL is hardcoded above —
 * this file is RunButter's own marketing chrome. `??` not `||`, so a fork can
 * switch the badge off with an empty value; with `||` an empty string would
 * fall back to ours and a fork's footer would quietly advertise us.
 */
const PH_POST_ID = process.env.NEXT_PUBLIC_PRODUCT_HUNT_POST_ID ?? '1199867';
const PH_URL = process.env.NEXT_PUBLIC_PRODUCT_HUNT_URL
  ?? 'https://www.producthunt.com/products/runbutter/launches/runbutter?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-runbutter';

const phBadge = PH_POST_ID && PH_URL
  ? {
      href: PH_URL,
      img: (theme: string) => `https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=${PH_POST_ID}&theme=${theme}`,
      label: 'RunButter on Product Hunt',
    }
  : null;

export async function MarketingFooter({ home = false }: { home?: boolean }) {
  const at = (hash: string) => (home ? hash : `/${hash}`);
  const stars = await starCount();
  const socials = SOCIALS.filter((s) => s.href);

  const columns: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
    {
      title: 'Product',
      links: [
        { label: 'Features', href: at('#features') },
        { label: 'AI agents', href: '/ai-agents' },
        { label: 'Compare', href: at('#compare') },
        { label: 'Pricing', href: at('#pricing') },
        { label: 'Start free', href: '/auth/register' },
      ],
    },
    {
      title: 'Resources',
      links: [
        // Every slug here is verified against lib/docs-nav.ts. A footer link to
        // a page that does not exist is the cheapest way to look abandoned.
        { label: 'Documentation', href: '/developers' },
        { label: 'Install guide', href: '/developers/install' },
        { label: 'REST API & MCP', href: '/developers/api' },
        // The two free tools. They had no route into them from any page but the
        // landing bento, which is the one place a stranger arriving from a
        // search for "how to write a SKILL.md" will never be.
        { label: 'Skill builder', href: '/plugins' },
        { label: 'PDF toolkit', href: '/pdf' },
        { label: 'Roadmap', href: '/developers/roadmap' },
        { label: 'Contributing', href: '/developers/contributing' },
        { label: 'Report a bug', href: `${REPO_URL}/issues/new/choose`, external: true },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'Contact', href: '/contact' },
        { label: 'Privacy', href: '/privacy' },
        { label: 'Terms', href: '/terms' },
        { label: 'Cookies', href: '/cookies' },
      ],
    },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-subtle">
      {/* The wordmark, oversized and mostly dissolved. It is decoration, so it
          is aria-hidden and cannot be selected — a screen reader announcing
          "RUNBUTTER" before every footer link is noise, and a stray drag
          selecting a ten-inch word is worse. The mask is what stops it reading
          as a heading: it is a texture the links sit on, not a title. */}
      <div aria-hidden className="pointer-events-none select-none absolute inset-x-0 top-0 flex justify-center overflow-hidden">
        <span
          className="font-medium leading-[0.78] tracking-[-0.055em] text-primary/[0.055] whitespace-nowrap
                     text-[clamp(4rem,17.5vw,15rem)]
                     [mask-image:linear-gradient(to_bottom,black_10%,transparent_92%)]
                     [-webkit-mask-image:linear-gradient(to_bottom,black_10%,transparent_92%)]"
        >
          RUNBUTTER
        </span>
      </div>

      <div className="relative max-w-6xl mx-auto px-6 pt-24 sm:pt-36 md:pt-52 pb-10">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand + the two asks */}
          <div className="min-w-0">
            <Logo mono />
            <p className="mt-3 text-xs text-tertiary leading-relaxed max-w-[34ch]">
              The open company OS: sales, finance, marketing, projects and people in one workspace.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {/* The star ask, with the real number when we have one. A count
                  is only rendered if GitHub actually answered — the project's
                  own rule about never showing a figure the data does not
                  support applies to its own vanity metrics too. */}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center h-8 rounded-md border border-subtle bg-surface text-primary text-xs font-medium hover:bg-surface-hover transition-colors overflow-hidden"
              >
                <span className="inline-flex items-center gap-1.5 px-2.5">
                  <Star className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110" />
                  Star on GitHub
                </span>
                {stars !== null && (
                  <span className="h-8 inline-flex items-center px-2.5 border-l border-subtle bg-surface-sunken tabular-nums text-secondary">
                    {stars.toLocaleString()}
                  </span>
                )}
              </a>

              {phBadge && (
                <a href={phBadge.href} target="_blank" rel="noopener noreferrer" aria-label={phBadge.label}>
                  {/* Two images rather than one: Product Hunt renders the badge
                      server-side per theme, so the light one on a dark footer is
                      a white slab. Height is pinned to h-8 to match the star
                      button beside it — a badge at its native 54px next to a
                      32px button reads as two rows pretending to be one.
                      eslint-disable because these are remote SVGs from another
                      origin: next/image would proxy them through our own
                      optimizer for no gain. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={phBadge.img('light')} alt={phBadge.label} width={250} height={54}
                    className="h-8 w-auto dark:hidden" loading="lazy"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={phBadge.img('dark')} alt={phBadge.label} width={250} height={54}
                    className="h-8 w-auto hidden dark:block" loading="lazy"
                  />
                </a>
              )}
            </div>
          </div>

          {columns.map((col) => (
            <div key={col.title} className="min-w-0">
              <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">{col.title}</div>
              <ul className="space-y-2 text-xs text-secondary">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary transition-colors">
                        {l.label} <ArrowUpRight className="w-3 h-3 text-tertiary" />
                      </a>
                    ) : (
                      <Link href={l.href} className="hover:text-primary transition-colors">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Two or more, not one. GitHub already has a prominent home in the
            brand block above, so a Community heading with a single icon under
            it is a section announcing its own emptiness. Add a second account
            and the row earns its place. */}
        {socials.length > 1 && (
          <div className="mt-12 pt-8 border-t border-subtle">
            <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Community</div>
            <div className="flex flex-wrap items-center gap-2">
              {socials.map((s) => (
                <a
                  key={s.name} href={s.href} target="_blank" rel="noopener noreferrer"
                  aria-label={s.name} title={s.name}
                  className="w-8 h-8 rounded-md border border-subtle bg-surface text-secondary hover:text-primary hover:border-strong transition-colors inline-flex items-center justify-center"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor" aria-hidden><path d={s.path} /></svg>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-tertiary">
          <span>© 2026 runbutter.app · MIT licensed</span>
          <span>Built on Postgres · no AI token bill</span>
        </div>
      </div>
    </footer>
  );
}
