import { ImageResponse } from 'next/og';
import { PRESETS } from '@/lib/design/presets';

/**
 * The builder's own card: six styles, side by side.
 *
 * Generated from `PRESETS` rather than drawn, so adding a style updates the
 * share image too — the same rule the gallery, the picker and the sitemap
 * follow. A hand-made picture of six styles is a seventh thing to keep in step.
 */

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Six design systems, each shown as its own palette and typeface.';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', background: '#0B0D10', display: 'flex',
        flexDirection: 'column', padding: 64, fontFamily: 'sans-serif',
      }}>
        <div style={{ fontSize: 22, color: '#8B939E', letterSpacing: 4, display: 'flex' }}>
          FREE · NO ACCOUNT · NOTHING UPLOADED
        </div>
        <div style={{ fontSize: 76, color: '#E6E8EB', marginTop: 16, lineHeight: 1.03, display: 'flex' }}>
          Stop your AI guessing
        </div>
        <div style={{ fontSize: 76, color: '#8B939E', lineHeight: 1.03, display: 'flex' }}>
          at your brand.
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 46 }}>
          {PRESETS.map((p) => {
            const at = (n: string, fb: string) => p.tokens.colors.find((c) => c.name === n)?.hex ?? fb;
            return (
              // Every tile carries a border in its OWN border colour. Without
              // one, Midnight Console — whose background is #0B0D10, the same
              // near-black as the card — disappeared completely, so the share
              // image advertised five styles and a hole.
              <div key={p.id} style={{
                flex: 1, background: at('background', '#fff'), borderRadius: 14,
                border: `1px solid ${at('border', '#333')}`,
                padding: 18, display: 'flex', flexDirection: 'column', height: 190,
              }}>
                <div style={{ fontSize: 21, color: at('foreground', '#111'), lineHeight: 1.1, display: 'flex' }}>
                  {p.label}
                </div>
                <div style={{ flex: 1 }} />
                {/* Five, on one line. Six wrapped to a second row in the
                    narrow tiles and made the grid look broken. */}
                <div style={{ display: 'flex', gap: 6 }}>
                  {p.tokens.colors.slice(0, 5).map((c, i) => (
                    <div key={i} style={{
                      width: 22, height: 22, borderRadius: 5, background: c.hex, display: 'flex',
                      border: `1px solid ${at('border', '#333')}`,
                    }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', marginTop: 40, alignItems: 'center' }}>
          <div style={{ fontSize: 26, color: '#8B939E', display: 'flex' }}>
            Upload a logo · get DESIGN.md, Tailwind v4, CSS variables
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 26, color: '#3DD68C', display: 'flex' }}>runbutter.app/brand</div>
        </div>
      </div>
    ),
    size,
  );
}
