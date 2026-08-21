import { ImageResponse } from 'next/og';
import { findPreset } from '@/lib/design/presets';
import { getPublishedStyle } from '@/lib/design/library-server';
import { readableOn } from '@/lib/design/color';

/**
 * The share card, drawn IN the style it is describing.
 *
 * ── A SHAREABLE ARTEFACT IS THE DISTRIBUTION, NOT AN EXTRA ──────────────────
 * Every style page was a link with no picture, which on X, Slack, Discord and
 * LinkedIn renders as a grey rectangle — so the one moment somebody might have
 * shown this to other people produced nothing worth looking at. A palette IS a
 * picture; not generating one was leaving the whole point on the floor.
 *
 * ── DRAWN FROM THE TOKENS, WHICH IS WHY IT CANNOT LIE ───────────────────────
 * The card is the spec rendering at 1200×630 — its own background, its own
 * type colour, its own swatches, its own button. A designed template with the
 * palette dropped in would look better and would be a picture ABOUT a style
 * rather than the style itself, and it would go stale the moment somebody
 * pressed Update.
 *
 * Node runtime, not edge: published styles come from Supabase through the admin
 * client, and the built-ins are a plain import. `alt` is real text because a
 * social card is often the only thing a screen reader gets.
 */

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A design system: its palette, typography and one button.';

export default async function Image({ params }: { params: { id: string } }) {
  const built = findPreset(params.id);
  const row = built ? null : await getPublishedStyle(params.id);
  const t = built?.tokens ?? row?.tokens;

  const name = built?.label ?? row?.name ?? 'A design system';
  const essence = built?.essence ?? row?.essence ?? '';

  const at = (n: string, fb: string) => t?.colors.find((c) => c.name === n)?.hex ?? fb;
  const bg = at('background', '#0B0D10');
  const fg = at('foreground', '#E6E8EB');
  const muted = at('muted', '#8B939E');
  const border = at('border', '#242A32');
  const primary = t?.colors.find((c) => c.name === 'primary')?.hex ?? at('accent', '#4F46E5');
  const onPrimary = t?.colors.find((c) => c.name === 'on-primary')?.hex ?? readableOn(primary);

  const display = t?.type.levels?.find((l) => l.name === 'display') ?? t?.type.levels?.[0];
  const swatches = (t?.colors ?? []).slice(0, 9);
  const radius = t?.radius?.find((r) => r.name === 'md')?.px ?? t?.radius?.[0]?.px ?? 10;

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', background: bg, display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', padding: 72, fontFamily: 'sans-serif',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{
            fontSize: 22, color: muted, letterSpacing: 4, textTransform: 'uppercase',
            display: 'flex',
          }}>
            DESIGN.md
          </div>
          <div style={{
            fontSize: 96, color: fg, marginTop: 20, lineHeight: 1.02,
            fontWeight: display?.fontWeight && display.fontWeight >= 600 ? 700 : 500,
            letterSpacing: display?.letterSpacing?.startsWith('-') ? -3 : 0,
            display: 'flex',
          }}>
            {name}
          </div>
          {essence ? (
            <div style={{ fontSize: 32, color: muted, marginTop: 22, maxWidth: 900, lineHeight: 1.35, display: 'flex' }}>
              {essence}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {swatches.map((c, i) => (
              <div key={i} style={{
                width: 84, height: 84, borderRadius: Math.min(radius, 20), background: c.hex,
                border: `1px solid ${border}`, display: 'flex',
              }} />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <div style={{
              background: primary, color: onPrimary, fontSize: 26, fontWeight: 600,
              padding: '18px 34px', borderRadius: Math.min(radius * 1.4, 999), display: 'flex',
            }}>
              Primary action
            </div>
            <div style={{
              color: fg, fontSize: 26, padding: '18px 32px',
              border: `2px solid ${border}`, borderRadius: Math.min(radius * 1.4, 999), display: 'flex',
            }}>
              Secondary
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 24, color: muted, display: 'flex' }}>runbutter.app/brand</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
