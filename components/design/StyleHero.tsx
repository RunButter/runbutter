import type { Preset } from '@/lib/design/presets';
import { mix, readableOn } from '@/lib/design/color';
import { resolveRefs } from '@/lib/design/export';

/**
 * The style, at full width, drawn from its own tokens.
 *
 * ── A RENDER, NOT A SCREENSHOT ──────────────────────────────────────────────
 * Reference libraries put a picture of a real website here, which is vivid and
 * has two problems: it goes stale the day that site redesigns, and it shows you
 * somebody else's page rather than the spec you are about to copy. This IS the
 * spec rendering. It cannot disagree with the file below it, and it cannot go
 * out of date, because there is nothing to keep in step.
 *
 * ── A SERVER COMPONENT, DELIBERATELY ────────────────────────────────────────
 * No state, no effects, so it lands in the HTML. The whole point of giving each
 * style a URL is that a crawler and an answer engine can see it; a hero that
 * paints after hydration is invisible to both.
 */
export default function StyleHero({ preset }: { preset: Preset }) {
  const t = preset.tokens;
  const at = (n: string, fb: string) => t.colors.find((c) => c.name === n)?.hex ?? fb;
  const bg = at('background', '#FFFFFF');
  const fg = at('foreground', '#111111');
  const muted = at('muted', '#6B7280');
  const surface = at('surface', '#F5F5F5');
  const border = at('border', '#E5E7EB');
  const primary = t.colors.find((c) => c.name === 'primary')?.hex ?? at('accent', '#4F46E5');
  const onPrimary = t.colors.find((c) => c.name === 'on-primary')?.hex ?? readableOn(primary);

  const level = (n: string) => t.type.levels?.find((l) => l.name === n);
  const heading = t.type.heading ? `"${t.type.heading}", sans-serif` : 'system-ui, sans-serif';
  const body = t.type.body ? `"${t.type.body}", sans-serif` : 'system-ui, sans-serif';
  const display = level('display') ?? level('h1');
  const bodyLevel = level('body-lg') ?? level('body-md');
  const rad = (n: string, fb: number) => t.radius.find((r) => r.name === n)?.px ?? fb;
  const step = (i: number, fb: number) => t.space.scale?.[i] ?? fb;
  const shadow = t.elevation[0] ? resolveRefs(t.elevation[0].value, t) : undefined;

  return (
    <section style={{ background: bg }} className="border-b border-subtle">
      <div style={{ maxWidth: 1152, margin: '0 auto', padding: `${step(5, 40)}px 24px ${step(5, 40)}px` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: step(3, 16), marginBottom: step(5, 40) }}>
          <span style={{ fontFamily: heading, fontSize: 19, fontWeight: 600, color: fg }}>{t.brand.name}</span>
          <span style={{ flex: 1 }} />
          {['Work', 'About', 'Contact'].map((x) => (
            <span key={x} style={{ fontFamily: body, fontSize: 13.5, color: muted }}>{x}</span>
          ))}
        </div>

        <h2 style={{
          fontFamily: display?.fontFamily ? `"${display.fontFamily}", sans-serif` : heading,
          fontSize: `clamp(34px, 6vw, ${display?.fontSize ?? 56}px)`,
          fontWeight: display?.fontWeight ?? 600,
          lineHeight: display?.lineHeight ?? 1.05,
          letterSpacing: display?.letterSpacing,
          color: fg, margin: 0, maxWidth: 15 + 'ch',
        }}>
          {t.brand.tagline}
        </h2>

        <p style={{
          fontFamily: body,
          fontSize: bodyLevel?.fontSize ?? 17,
          lineHeight: bodyLevel?.lineHeight ?? 1.6,
          color: muted, maxWidth: 62 + 'ch', marginTop: step(2, 12),
        }}>
          {preset.essence} {t.brand.description}
        </p>

        <div style={{ display: 'flex', gap: step(1, 8), marginTop: step(4, 24), flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            fontFamily: body, fontSize: level('label')?.fontSize ?? 13,
            fontWeight: level('label')?.fontWeight ?? 600,
            letterSpacing: level('label')?.letterSpacing,
            background: primary, color: onPrimary,
            padding: `${step(1, 10)}px ${step(3, 20)}px`,
            borderRadius: rad('full', rad('md', 10)),
            border: border === fg ? `2px solid ${fg}` : 'none',
            boxShadow: shadow,
          }}>
            Primary action
          </span>
          <span style={{
            fontFamily: body, fontSize: level('label')?.fontSize ?? 13, fontWeight: 500,
            color: fg, padding: `${step(1, 10)}px ${step(3, 20)}px`,
            borderRadius: rad('full', rad('md', 10)), border: `1px solid ${border}`,
          }}>
            Secondary
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ display: 'flex', gap: 5 }}>
            {t.colors.map((c) => (
              <span key={c.name} title={`${c.name} ${c.hex}`} style={{
                width: 26, height: 26, borderRadius: rad('sm', 4), background: c.hex,
                boxShadow: 'inset 0 0 0 1px rgb(128 128 128 / 0.25)',
              }} />
            ))}
          </span>
        </div>

        <div style={{
          marginTop: step(5, 40), display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: step(2, 12),
        }}>
          {(t.type.levels ?? []).slice(0, 3).map((l) => (
            <div key={l.name} style={{
              background: surface, border: `1px solid ${border}`,
              borderRadius: rad('lg', rad('md', 12)), padding: step(3, 18), boxShadow: shadow,
            }}>
              <div style={{ fontFamily: t.type.mono ? `"${t.type.mono}", monospace` : 'ui-monospace, monospace', fontSize: 10.5, color: muted }}>
                {l.name} · {l.fontSize}px{l.fontWeight ? ` · ${l.fontWeight}` : ''}
              </div>
              <div style={{
                fontFamily: l.fontFamily ? `"${l.fontFamily}", sans-serif` : (/^h[1-6]$|^display|^title/i.test(l.name) ? heading : body),
                fontSize: Math.min(l.fontSize, 30), fontWeight: l.fontWeight ?? 400,
                lineHeight: l.lineHeight ?? 1.2, letterSpacing: l.letterSpacing,
                color: fg, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {mixLabel(l.name)}
              </div>
              {l.use && (
                <div style={{ fontFamily: body, fontSize: 11.5, color: muted, marginTop: 6, lineHeight: 1.45 }}>{l.use}</div>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: step(3, 18), height: 1, background: mix(border, bg, 0.3) }} />
      </div>
    </section>
  );
}

const mixLabel = (name: string) =>
  (/^display|^h1/i.test(name) ? 'Design is how it works'
    : /^h[2-6]|^title/i.test(name) ? 'A section heading'
    : /label|meta|byline|caption/i.test(name) ? 'SUPPORTING TEXT'
    : 'The quick brown fox jumps');
