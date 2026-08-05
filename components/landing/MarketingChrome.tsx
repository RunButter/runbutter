import Link from 'next/link';
import { Github } from 'lucide-react';
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
          <Link href={at('#developers')} className="hidden md:inline hover:text-primary transition-colors">Developers</Link>
          <Link href={at('#pricing')} className="hidden md:inline hover:text-primary transition-colors">Pricing</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hidden sm:inline-flex items-center gap-1.5 hover:text-primary transition-colors"><Github className="w-4 h-4" /> GitHub</a>
          <ThemeToggle />
          <Link href="/auth/register" className="inline-flex items-center h-8 px-3 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity">Start free</Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter({ home = false }: { home?: boolean }) {
  const at = (hash: string) => (home ? hash : `/${hash}`);
  return (
    <footer className="border-t border-subtle">
      <div className="max-w-6xl mx-auto px-6 py-12 grid gap-10 sm:grid-cols-3">
        <div>
          <Logo mono />
          <p className="mt-3 text-xs text-tertiary leading-relaxed max-w-[32ch]">
            The open company OS: sales, finance, marketing, projects, and people in one workspace.
          </p>
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Product</div>
          <ul className="space-y-2 text-xs text-secondary">
            <li><Link href={at('#features')} className="hover:text-primary transition-colors">Features</Link></li>
            <li><Link href="/ai-agents" className="hover:text-primary transition-colors">AI agents</Link></li>
            <li><Link href={at('#compare')} className="hover:text-primary transition-colors">Compare</Link></li>
            <li><Link href={at('#pricing')} className="hover:text-primary transition-colors">Pricing</Link></li>
            <li><a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">GitHub</a></li>
            <li><Link href="/auth/register" className="hover:text-primary transition-colors">Start free</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Company</div>
          <ul className="space-y-2 text-xs text-secondary">
            <li><Link href="/contact" className="hover:text-primary transition-colors">Contact</Link></li>
            <li><Link href="/privacy" className="hover:text-primary transition-colors">Privacy</Link></li>
            <li><Link href="/terms" className="hover:text-primary transition-colors">Terms</Link></li>
            <li><Link href="/cookies" className="hover:text-primary transition-colors">Cookies</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-subtle">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-tertiary">
          <span>© 2026 runbutter.app</span>
          <span>Built on Postgres · MIT licensed · no AI token bill</span>
        </div>
      </div>
    </footer>
  );
}
