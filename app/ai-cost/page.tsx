import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Calculator } from 'lucide-react';
import AgentCostCalculator from '@/components/landing/AgentCostCalculator';
import { MarketingHeader, MarketingFooter } from '@/components/landing/MarketingChrome';
import StructuredData from '@/components/landing/StructuredData';
import { SITE_URL } from '@/lib/site';

/**
 * A free tool that answers a question nothing else answers.
 *
 * The other free tools here (/pdf, /qr, /plugins) follow one rule: genuinely
 * useful, no account, nothing uploaded, and honestly connected to what the
 * product does. This one adds the rule that makes a free tool worth building at
 * all — IT MUST ANSWER SOMETHING NOBODY ELSE DOES. There are a dozen LLM price
 * calculators and every one of them computes `input × price + output × price`,
 * which is correct for a single call and wrong for an agent by a large
 * multiple, because an agent re-sends its system prompt and tool definitions on
 * every step.
 *
 * Nothing on the web prices that loop. We had to work it out to build the
 * product, so publishing it costs one page and is the most credible possible
 * argument for the thing we sell: here is the arithmetic, here is why your
 * nightly agent is affordable, and here is where you can run one.
 *
 * Entirely static and client-side. No key, no account, no network.
 */

const TITLE = 'AI agent cost calculator — what a tool-using loop really costs';
const DESCRIPTION =
  'Price an AI agent properly. Every other calculator prices one API call; an agent re-sends its system prompt and tools on every step. Compare Claude, GPT and Gemini on a real loop, with and without prompt caching. Free, no account.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/ai-cost` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/ai-cost`, type: 'website' },
};

/**
 * Answered on the page, in the same words.
 *
 * Google treats an FAQPage whose questions are not visible as spam, so the
 * array is passed to StructuredData AND rendered below — the same rule the
 * landing page follows.
 */
const FAQ = [
  {
    q: 'Why is an AI agent more expensive than one API call?',
    a: 'An agent is a loop. Before it answers, it calls tools — reading records, searching files — and every one of those turns re-sends the system prompt, the tool definitions and everything that has happened so far. A twenty-step run can send its system prompt twenty times. A calculator that multiplies input by price once will under-count that by an order of magnitude.',
  },
  {
    q: 'What is prompt caching and how much does it save?',
    a: 'Providers let you mark the unchanging start of a prompt as cacheable and then bill it at a lower rate on later calls — roughly a tenth on Anthropic, about half on OpenAI. Because an agent re-sends the same system prompt and tools every step, that prefix is exactly what caching is for. On a long loop it is often the majority of the bill.',
  },
  {
    q: 'Why does the prompt grow during a run?',
    a: 'Each tool result is appended to the conversation, so step five carries everything from steps one to four. The accumulated history is re-sent every time, which makes the cost of a long run grow with the square of its length rather than linearly.',
  },
  {
    q: 'Are these prices current?',
    a: 'They are published list prices, dated on the page. Your real rate can differ — negotiated pricing, an OpenRouter upstream, or a self-hosted model that costs nothing per token. Treat the comparison between models as the reliable part and the absolute figure as an estimate.',
  },
];

export default function AiCostPage() {
  return (
    <>
      <StructuredData faq={FAQ} />
      <MarketingHeader />

      <main className="min-h-screen">
        <section className="border-b border-subtle">
          <div className="max-w-5xl mx-auto px-6 py-16 md:py-24">
            <span className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-accent-text">
              <Calculator className="w-3.5 h-3.5" /> Free tool
            </span>
            <h1 className="text-3xl md:text-5xl font-medium tracking-tight mt-3 max-w-3xl">
              What an AI agent actually costs to run
            </h1>
            <p className="text-secondary mt-4 max-w-2xl leading-relaxed">
              Every other calculator prices one API call. An agent is a loop — it re-sends its system
              prompt and tool definitions on every step, and carries the whole conversation with it.
              This prices that, with and without prompt caching, because the difference decides
              whether a nightly agent is sensible or absurd.
            </p>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-6 py-12">
          <AgentCostCalculator />
        </section>

        <section className="border-t border-subtle">
          <div className="max-w-3xl mx-auto px-6 py-16">
            <h2 className="text-xl font-medium tracking-tight mb-6">Questions</h2>
            <dl className="space-y-6">
              {FAQ.map((f) => (
                <div key={f.q}>
                  <dt className="text-sm font-medium text-primary">{f.q}</dt>
                  <dd className="text-sm text-secondary mt-1.5 leading-relaxed">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-subtle bg-surface-sunken">
          <div className="max-w-3xl mx-auto px-6 py-16 text-center">
            <h2 className="text-xl md:text-2xl font-medium tracking-tight">
              We worked this out because we had to
            </h2>
            <p className="text-secondary mt-3 leading-relaxed">
              RunButter runs agents against your own business data on your own AI key — so the loop
              above is our arithmetic, not a thought experiment. It caches the prefix, counts what
              every run actually spent, and shows you which agent is costing the most.
            </p>
            <Link href="/" className="btn-primary mt-6 inline-flex">
              See what it is <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
