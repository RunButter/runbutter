'use client';

import { ThinkingLine, type ThinkingKind } from '@/components/ui/Thinking';

/**
 * The one full-page wait.
 *
 * Every screen in the app used to open with its own centred `Loader2`, which
 * meant the very first thing anyone saw after signing in — and again on every
 * tab — was a bare grey spinner, the most generic possible loading state. This
 * replaces all of them with the same orb and a sentence, so the wait is
 * recognisably RunButter and says what it is waiting for.
 *
 * One component rather than a copied snippet, because the reason there were
 * fifty spinners is that a snippet is easier to paste than to import.
 */
export default function AppLoading({
  label = 'Loading your workspace', hint, kind = 'idle', className = '',
}: { label?: string; hint?: string; kind?: ThinkingKind; className?: string }) {
  return (
    <div className={`h-full min-h-[60vh] flex items-center justify-center p-8 ${className}`}>
      <ThinkingLine kind={kind} size="avatar" label={label} hint={hint} />
    </div>
  );
}
