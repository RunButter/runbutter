import Reveal from '@/components/landing/Reveal';

/**
 * The five modules that never had a picture on this page — Post studio, PDF
 * tools, Web analytics, Mind maps and the personality chart — as a bento of
 * small windows.
 *
 * Every number below is invented, and that is allowed here only because the
 * whole block is framed as a mockup: these are drawings of the UI, not a
 * dashboard reporting on anything. The rule that matters ("no fabricated data")
 * is about the product never inventing a figure and presenting it as measured;
 * a landing-page mock of an empty product has to show something.
 *
 * Deliberately monochrome, like the rest of the page: the app is colourful, the
 * marketing is not, and mixing the two makes the page look like a screenshot
 * dump. Everything is drawn with tokens and inline SVG rather than a chart
 * library, so this section adds no JavaScript at all.
 */

/**
 * The window chrome. It STRETCHES to fill its card (`h-full`, content centred),
 * because the cards in a row are equal height and the mocks inside them are not.
 * Letting the frame stay its natural size left a bare gap under the short ones;
 * growing the window instead puts that space inside the frame, where it reads as
 * an app window with room in it rather than as a layout mistake.
 */
function Frame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`h-full flex flex-col rounded-lg bg-surface border border-subtle overflow-hidden ${className}`}>
      <div className="h-7 shrink-0 flex items-center gap-1.5 px-2.5 border-b border-subtle bg-surface-sunken">
        <span className="w-1.5 h-1.5 rounded-full bg-strong" />
        <span className="w-1.5 h-1.5 rounded-full bg-strong" />
        <span className="w-1.5 h-1.5 rounded-full bg-strong" />
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-center">{children}</div>
    </div>
  );
}

function Card({ title, body, span, delay, children }: {
  title: string; body: string; span: string; delay?: number; children: React.ReactNode;
}) {
  return (
    // min-w-0 on the cell: a grid track is min-content wide by default, so one
    // wide mock sets a floor the phone viewport cannot meet and the whole page
    // scrolls sideways. This page has been bitten by exactly that before.
    <div className={`min-w-0 ${span}`}>
      {/* h-full has to run the whole chain — cell, Reveal, card — or the grid
          stretches the cell and the card inside it still shrink-wraps, which is
          why the bottom row's three cards ended at three different heights. */}
      <Reveal variant="up" delay={delay} className="h-full">
        <div className="h-full rounded-xl bg-surface-sunken/60 border border-subtle p-3 sm:p-4 flex flex-col gap-3">
          <div className="flex-1 min-h-0">{children}</div>
          <div className="shrink-0">
            <div className="text-sm font-medium text-primary">{title}</div>
            <div className="text-xs text-secondary mt-0.5 leading-snug">{body}</div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/* ── Post studio ────────────────────────────────────────────────────────────
   The differentiator is client sign-off, so the pinned comment is the subject
   of the drawing and the post is the backdrop. */
function PostStudio() {
  return (
    <Frame>
      <div className="flex items-center gap-1 px-2.5 py-2 border-b border-subtle">
        {['LinkedIn', 'X', 'Instagram'].map((p, i) => (
          <span key={p} className={`text-3xs px-1.5 py-0.5 rounded font-medium ${i === 0 ? 'bg-inverse text-inverse-fg' : 'text-tertiary'}`}>{p}</span>
        ))}
        <span className="ml-auto text-3xs text-tertiary">Draft</span>
      </div>
      <div className="p-3">
        <div className="rounded-lg border border-subtle p-2.5 bg-surface">
          <div className="flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-surface-hover border border-subtle" />
            <div className="min-w-0">
              <div className="text-3xs font-medium text-primary">Northwind</div>
              <div className="text-3xs text-tertiary">Sponsored</div>
            </div>
          </div>
          <div className="mt-2 space-y-1">
            <div className="h-1.5 rounded bg-surface-hover w-full" />
            <div className="h-1.5 rounded bg-surface-hover w-4/5" />
          </div>
          <div className="mt-2 h-14 rounded bg-surface-hover border border-subtle" />
        </div>
        {/* A pinned comment, anchored to a spot on the post. */}
        <div className="relative mt-2 rounded-lg border border-strong bg-surface px-2 py-1.5">
          <span className="absolute -top-1.5 left-3 w-3 h-3 rounded-full bg-inverse text-inverse-fg text-[8px] leading-3 text-center font-medium">1</span>
          <div className="text-3xs text-secondary">“Can we tighten the second line?”</div>
        </div>
      </div>
    </Frame>
  );
}

/* ── Personality chart ──────────────────────────────────────────────────────
   A real Big-5 pentagon, drawn as SVG. Five axes because there are five
   traits — not a decorative shape that happens to have five points. */
// The five trait names the assessment actually scores (`lib/questions.ts`),
// including Neuroticism — renaming it to something friendlier here would put a
// label on the marketing page that appears nowhere in the product. Written out
// rather than abbreviated: "Conscientio…" in a mock reads as a layout bug, and
// the claim being made is that these are real Big-5 traits and not a decorative
// five-pointed shape.
const BIG5 = [
  { k: 'Openness', v: 0.82 },
  { k: 'Conscientiousness', v: 0.74 },
  { k: 'Extraversion', v: 0.55 },
  { k: 'Agreeableness', v: 0.68 },
  { k: 'Neuroticism', v: 0.29 },
];

function pentagon(r: number, cx = 60, cy = 58) {
  return BIG5.map((_, i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');
}

function PersonalityChart() {
  const shape = BIG5.map((t, i) => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const r = 42 * t.v;
    return `${(60 + Math.cos(a) * r).toFixed(1)},${(58 + Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');

  return (
    <Frame>
      <div className="p-3 flex items-center gap-3">
        {/* Smaller on a phone: at 390px the full-size pentagon left the bars
            about 60px wide, which is a decoration rather than a reading. */}
        <svg viewBox="0 0 120 116" className="w-[86px] h-[84px] sm:w-[120px] sm:h-[116px] shrink-0" aria-hidden="true">
          {[42, 28, 14].map((r) => (
            <polygon key={r} points={pentagon(r)} fill="none"
              stroke="hsl(var(--border-subtle))" strokeWidth="1" />
          ))}
          {BIG5.map((_, i) => {
            const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
            return <line key={i} x1="60" y1="58" x2={60 + Math.cos(a) * 42} y2={58 + Math.sin(a) * 42}
              stroke="hsl(var(--border-subtle))" strokeWidth="1" />;
          })}
          <polygon points={shape} fill="hsl(var(--text-primary) / 0.12)"
            stroke="hsl(var(--text-primary))" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0 flex-1 space-y-1">
          {BIG5.map((t) => (
            <div key={t.k} className="flex items-center gap-2">
              {/* Wide enough for "Conscientiousness" at this size — the label is
                  the evidence that these are the real traits, so truncating it
                  defeats the point of showing them. */}
              <span className="text-3xs text-tertiary w-[108px] shrink-0">{t.k}</span>
              <span className="h-1 rounded-full bg-surface-hover flex-1 min-w-0 overflow-hidden">
                <span className="block h-full rounded-full bg-inverse" style={{ width: `${t.v * 100}%` }} />
              </span>
              <span className="text-3xs font-mono text-secondary tabular-nums w-5 text-right">{Math.round(t.v * 100)}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/* ── Mind maps ──────────────────────────────────────────────────────────────
   Nodes and edges, drawn once. A picture of a mind map has to actually branch
   or it is just five boxes. */
const NODES = [
  { x: 54, y: 40, w: 44, label: 'Launch' },
  { x: 8, y: 12, w: 36, label: 'Pricing' },
  { x: 8, y: 68, w: 36, label: 'Docs' },
  { x: 108, y: 10, w: 40, label: 'Site' },
  { x: 108, y: 46, w: 40, label: 'Press' },
  { x: 108, y: 76, w: 40, label: 'Ads' },
];
const EDGES: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]];

function MindMap() {
  return (
    <Frame>
      <div className="p-3">
        <svg viewBox="0 0 152 96" className="w-full h-[96px]" aria-hidden="true">
          {EDGES.map(([a, b], i) => {
            const A = NODES[a], B = NODES[b];
            const ax = A.x + A.w / 2, ay = A.y + 8;
            const bx = B.x + B.w / 2, by = B.y + 8;
            return <path key={i} d={`M${ax},${ay} C${(ax + bx) / 2},${ay} ${(ax + bx) / 2},${by} ${bx},${by}`}
              fill="none" stroke="hsl(var(--border-strong))" strokeWidth="1" />;
          })}
          {NODES.map((n, i) => (
            <g key={n.label}>
              <rect x={n.x} y={n.y} width={n.w} height={16} rx="4"
                fill={i === 0 ? 'hsl(var(--text-primary))' : 'hsl(var(--surface))'}
                stroke="hsl(var(--border-subtle))" strokeWidth="1" />
              <text x={n.x + n.w / 2} y={n.y + 11} textAnchor="middle" fontSize="7"
                fill={i === 0 ? 'hsl(var(--surface))' : 'hsl(var(--text-secondary))'}>{n.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </Frame>
  );
}

/* ── PDF tools ──────────────────────────────────────────────────────────────
   The point is that files never leave the browser, so the drawing shows page
   thumbnails being reordered rather than an upload progress bar. */
function PdfTools() {
  return (
    <Frame>
      <div className="p-3">
        <div className="flex flex-wrap gap-1 mb-2.5">
          {['Merge', 'Split', 'Rotate', 'Watermark'].map((t, i) => (
            <span key={t} className={`text-3xs px-1.5 py-0.5 rounded font-medium ${i === 0 ? 'bg-inverse text-inverse-fg' : 'text-tertiary border border-subtle'}`}>{t}</span>
          ))}
        </div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex-1 min-w-0 aspect-[3/4] rounded border border-subtle bg-surface p-1 flex flex-col gap-0.5">
              <span className="h-0.5 rounded bg-surface-hover w-full" />
              <span className="h-0.5 rounded bg-surface-hover w-4/5" />
              <span className="h-0.5 rounded bg-surface-hover w-full" />
              <span className="mt-auto text-3xs text-tertiary text-center leading-none">{n}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 text-3xs text-tertiary">Runs in your browser — nothing uploads.</div>
      </div>
    </Frame>
  );
}

/* ── Web analytics ──────────────────────────────────────────────────────────
   Countries and browsers, because that is what 0062 actually added, and
   "Unknown" is kept as its own row for the same reason the product keeps it:
   a country list that hides its gaps looks more authoritative than it is. */
function WebAnalytics() {
  const rows: [string, number][] = [
    ['Poland', 46], ['Germany', 23], ['United States', 16], ['Unknown', 15],
  ];
  return (
    <Frame>
      <div className="p-3">
        <div className="grid grid-cols-2 gap-2 mb-2.5">
          {[['Visitors', '2,480'], ['Pages', '6,120']].map((k) => (
            <div key={k[0]} className="rounded border border-subtle p-1.5">
              <div className="text-3xs uppercase tracking-wide text-tertiary">{k[0]}</div>
              <div className="text-sm font-mono text-primary">{k[1]}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {rows.map(([c, pct]) => (
            <div key={c} className="flex items-center gap-2">
              <span className="text-3xs text-secondary w-[78px] shrink-0 truncate">{c}</span>
              <span className="h-1.5 rounded-full bg-surface-hover flex-1 min-w-0 overflow-hidden">
                <span className={`block h-full rounded-full ${c === 'Unknown' ? 'bg-strong' : 'bg-inverse'}`} style={{ width: `${pct}%` }} />
              </span>
              <span className="text-3xs font-mono text-tertiary tabular-nums w-6 text-right">{pct}%</span>
            </div>
          ))}
        </div>
        <div className="mt-2 text-3xs text-tertiary">Cookieless. No banner, no third-party tracker.</div>
      </div>
    </Frame>
  );
}

export default function FeatureWindows() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <div className="text-2xs font-medium uppercase tracking-wider text-tertiary mb-3">Also included</div>
        <h3 className="text-2xl md:text-3xl font-medium tracking-tight text-primary">
          Five more things you would otherwise buy
        </h3>
        <p className="mt-3 text-secondary leading-relaxed">
          Not add-ons and not a roadmap — these ship in the same app, on the same database,
          on the free plan. Mockups, not screenshots of your data.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
        <Card span="lg:col-span-3" title="Post studio" delay={0}
          body="Draft once, preview per platform, and collect client sign-off as comments pinned to the post itself.">
          <PostStudio />
        </Card>
        <Card span="lg:col-span-3" title="Personality chart" delay={70}
          body="Big-5 traits alongside skills, scored in Postgres. No cognitive test, no IQ claim, no per-token AI bill.">
          <PersonalityChart />
        </Card>
        <Card span="lg:col-span-2" title="Mind maps" delay={0}
          body="Think on a canvas, then keep it next to the work it belongs to.">
          <MindMap />
        </Card>
        <Card span="lg:col-span-2" title="PDF tools" delay={70}
          body="Merge, split, rotate and watermark — entirely in the browser, so files never leave your machine.">
          <PdfTools />
        </Card>
        <Card span="lg:col-span-2" title="Web analytics" delay={140}
          body="First-party visitors, countries and browsers, with no cookie banner to add.">
          <WebAnalytics />
        </Card>
      </div>
    </section>
  );
}
