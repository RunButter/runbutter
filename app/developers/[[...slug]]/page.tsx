import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { Github } from '@/components/ui/BrandIcons';
import { MarketingHeader, MarketingFooter, REPO_URL } from '@/components/landing/MarketingChrome';
import { renderMarkdown } from '@/lib/markdown';
import { DOCS_NAV, ALL_DOC_SLUGS, docTitle } from '@/lib/docs-nav';
import DocsNav from '@/components/docs/DocsNav';

/**
 * The documentation site, rendered from the markdown in docs/.
 *
 * It lives at /developers rather than /docs because /docs is the app's own
 * Docs screen — the product came first and renaming a signed-in route to make
 * room for marketing would break every link anyone has saved.
 *
 * ONE SOURCE, TWO SURFACES. The same files are the docs on GitHub and the docs
 * on the website. A separate CMS or a docs-only copy is how a project ends up
 * with an install page that is right in one place and eighteen months old in
 * the other — and the one people find first is always the wrong one.
 *
 * Read at BUILD time, from the repository, so there is no request-time file
 * access and the pages are static. Content is repo-owned and reviewed in pull
 * requests; the renderer still escapes the source, so a stray `<script>` in a
 * doc is characters rather than a script.
 */

const DOCS_DIR = join(process.cwd(), 'docs');

/**
 * Make the links work on both surfaces.
 *
 * The markdown links to sibling pages the way GitHub needs — `./install.md` —
 * and rendering that verbatim on the site gives `/developers/install.md`, which
 * is a 404 on every cross-reference in the docs. Links that point OUT of docs/
 * (`../CONTRIBUTING.md`, `../supabase/schema.sql`) have no page here at all, so
 * they go to the file on GitHub.
 *
 * Rewriting at render time rather than writing site-shaped links in the source
 * keeps the files readable in a text editor and correct in a pull request diff,
 * which is where most people will actually read them.
 */
function siteLinks(html: string): string {
  return html
    .replace(/href="\.\.\/([^"]+)"/g, `href="${REPO_URL}/blob/main/$1"`)
    .replace(/href="(?:\.\/)?([a-z0-9-]+)\.md(#[^"]*)?"/g, (_m, page, frag) => `href="/developers/${page}${frag || ''}"`);
}

const fileFor = (slug: string) => join(DOCS_DIR, `${slug}.md`);

// Only the pages in the sidebar are prerendered. Anything else in docs/ still
// resolves on demand rather than 404ing, which keeps a link in a commit message
// working without it having to earn a place in the nav.
export function generateStaticParams() {
  return ALL_DOC_SLUGS.map((slug) => ({ slug: slug === 'index' ? [] : [slug] }));
}

const slugFrom = (params: { slug?: string[] }) => (params.slug?.length ? params.slug.join('/') : 'index');

export function generateMetadata({ params }: { params: { slug?: string[] } }): Metadata {
  const slug = slugFrom(params);
  if (!existsSync(fileFor(slug))) return { title: 'Docs — RunButter' };
  const { title } = renderMarkdown(readFileSync(fileFor(slug), 'utf8'));
  const name = docTitle(slug) || title || 'Docs';
  return {
    title: `${name} — RunButter docs`,
    description: 'Documentation for RunButter, the open-source company OS.',
  };
}

export default function DocPage({ params }: { params: { slug?: string[] } }) {
  const slug = slugFrom(params);
  // A slug is a path into the repo, so it is checked rather than trusted: no
  // traversal, no absolute paths, nothing outside docs/.
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(slug) || !existsSync(fileFor(slug))) notFound();

  const { html, title, headings } = renderMarkdown(readFileSync(fileFor(slug), 'utf8'));
  const onThisPage = headings.filter((h) => h.level === 2);

  return (
    <div className="min-h-screen bg-canvas text-primary antialiased">
      <MarketingHeader />

      <div className="max-w-6xl mx-auto px-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <DocsNav sections={DOCS_NAV} current={slug} />

        <main className="py-10 min-w-0">
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_11rem] lg:gap-10">
            <article className="doc-prose min-w-0" dangerouslySetInnerHTML={{ __html: siteLinks(html) }} />

            {onThisPage.length > 2 && (
              <aside className="hidden lg:block">
                <div className="sticky top-20">
                  <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-2">On this page</div>
                  <ul className="space-y-1.5 border-l border-subtle">
                    {onThisPage.map((h) => (
                      <li key={h.id}>
                        <a href={`#${h.id}`} className="block pl-3 -ml-px border-l border-transparent text-xs text-secondary hover:text-primary hover:border-strong transition-colors">
                          {h.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </aside>
            )}
          </div>

          <div className="mt-12 pt-6 border-t border-subtle flex flex-wrap items-center justify-between gap-3 text-xs">
            <Link href="/developers" className="inline-flex items-center gap-1.5 text-secondary hover:text-primary transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> All docs
            </Link>
            {/* Every page says where it lives. A doc that was wrong when someone
                followed it is the most useful bug report there is, and the edit
                link is what turns the thought into a pull request. */}
            <a
              href={`${REPO_URL}/edit/main/docs/${slug}.md`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-secondary hover:text-primary transition-colors"
            >
              <Github className="w-3.5 h-3.5" /> Edit this page — {title || slug}
            </a>
          </div>
        </main>
      </div>

      <MarketingFooter />
    </div>
  );
}
