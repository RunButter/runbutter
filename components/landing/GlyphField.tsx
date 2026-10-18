'use client';

import { useEffect, useRef } from 'react';
import { WORLD_MASK } from '@/lib/landing/world-mask';

/**
 * A field of letters and digits that make up a map of the world, alive under
 * the cursor — RunButter's own take on the "living ASCII" backdrop.
 *
 * ── WHY WEBGL, WHEN AsciiField WAS CANVAS 2D ──────────────────────────────
 * AsciiField drew every glyph with fillText from JavaScript, and fillText is
 * the floor cost: v3 had to cap the cells, cache the noise and hold 30 fps to
 * keep the main thread breathing, and it still read as a little stiff. Here
 * the CPU does nothing per frame but set a dozen uniforms and issue ONE draw
 * call. Every cell — which glyph, how bright, the cursor glow, the ripples —
 * is decided on the GPU, once per cell, and drawn from a glyph atlas texture.
 * That is what buys a steady 60 fps at full resolution with the main thread
 * idle; the smoothness is the architecture, not tuning.
 *
 * ── WHAT IT DOES ──────────────────────────────────────────────────────────
 * - Land (lib/landing/world-mask.ts, Natural Earth) is dense; the sea carries
 *   a sparse scatter, so the screen is never a hard-edged picture.
 * - Each cell swaps its glyph now and then, at its own pace, and its
 *   brightness breathes on a slow wave — a shimmer, not a flicker.
 * - The cursor brings a soft light: glyphs brighten and scramble under it and
 *   appear out of the sea. Moving leaves faint rings behind; a click sends a
 *   stronger one. The canvas never takes a click — pointer events are read
 *   from the window — so everything over it stays usable.
 *
 * ── MANNERS ───────────────────────────────────────────────────────────────
 * - The first frame is drawn at once; the loop starts after `load` + idle, so
 *   the animation never sits in the window Lighthouse scores as blocking.
 * - It stops when the tab is hidden or the field is scrolled away.
 * - prefers-reduced-motion: no drift, no ripples; it redraws only when the
 *   cursor moves.
 * - No WebGL (or a lost context): it draws nothing, and the page is the same
 *   page with a plain background.
 */

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ATLAS_COLS = 8;
const MAX_RIPPLES = 8;

// ONE POINT PER CELL. Everything a cell decides — is it shown, how bright,
// which glyph, the cursor's light, the rings — is worked out in the VERTEX
// shader, once per cell (~10k of them), and the fragment shader only looks the
// glyph up in the atlas. Doing that work per PIXEL instead (the first version)
// is 150× the arithmetic for the same picture: it held 60 fps on a GPU and
// 2 fps on a software renderer, which is what a laptop with GPU blocklisting
// actually gets. The static per-cell inputs (land, two random seeds) are a
// vertex buffer rebuilt on resize, so no texture is read in the vertex stage.
const VERT = `
attribute vec2 aCell;
attribute vec3 aSeed;   // land 0–1, h, h2
uniform vec2 uRes;
uniform float uCell;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHover;
uniform float uRadius;
uniform vec4 uRip[${MAX_RIPPLES}];
uniform float uBase;
uniform float uSea;
uniform float uUseMap;
varying float vAlpha;
varying vec2 vSlot;

float hash(float a, float b) {
  return fract(sin(a * 12.9898 + b * 78.233) * 43758.5453);
}

void main() {
  vec2 center = (aCell + 0.5) * uCell;
  float land = aSeed.x;
  if (uUseMap < 0.5) land = 0.55 + 0.45 * sin(aCell.x * 0.11 + uTime * 0.05) * sin(aCell.y * 0.17 - uTime * 0.04);
  float h = aSeed.y;
  float h2 = aSeed.z;

  // The cursor's light, and the rings it leaves.
  float d = length(center - uMouse);
  float glow = uHover * exp(-(d * d) / (uRadius * uRadius));
  float ring = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRip[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 2.6) continue;
    float dr = length(center - r.xy) - age * uRadius * 2.6;
    float fade = 1.0 - age / 2.6;
    ring += r.w * exp(-(dr * dr) / (uCell * uCell * 2.2)) * fade * fade;
  }
  float lift = clamp(glow + ring, 0.0, 1.5);

  // Land is dense; the sea is a scatter that the light fills in.
  float landness = smoothstep(0.2, 0.8, land);
  float density = mix(uSea, 0.9, landness);
  float wave = 0.5 + 0.5 * sin(uTime * 0.6 + h * 6.2831 + (aCell.x - aCell.y) * 0.045);
  float alpha = clamp(mix(uBase * 0.45, uBase, landness) * mix(0.45, 1.0, wave) + lift * 0.85, 0.0, 1.0);

  if (h > density + lift * 0.9 || alpha < 0.004) {
    // Not drawn this frame: off-screen, so the rasteriser drops it.
    vAlpha = 0.0; vSlot = vec2(0.0);
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    return;
  }

  // A glyph swaps at its own slow pace, and scrambles under the light.
  float rate = mix(0.08, 0.45, h2) * (1.0 + 14.0 * lift);
  float idx = floor(hash(h * 997.0, floor(uTime * rate + h2 * 10.0)) * ${GLYPHS.length}.0);
  vSlot = vec2(mod(idx, ${ATLAS_COLS}.0), floor(idx / ${ATLAS_COLS}.0));
  vAlpha = alpha;

  vec2 clip = center / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = uCell;
}
`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uAtlas;
uniform vec3 uInk;
varying float vAlpha;
varying vec2 vSlot;

void main() {
  float a = vAlpha * texture2D(uAtlas, (vSlot + gl_PointCoord) / ${ATLAS_COLS}.0).a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uInk * a, a);
}
`;

export interface GlyphFieldProps {
  /** Glyph colour as "r,g,b" (0–255). */
  ink?: string;
  /** Brightness of land glyphs at rest, 0–1. */
  base?: number;
  /** Share of sea cells that carry a glyph at rest, 0–1. */
  sea?: number;
  /** Cell size in CSS pixels. */
  cell?: number;
  /** Draw the world map; false = a slow, map-less shimmer. */
  map?: boolean;
  /** Map width as a share of the canvas width. */
  mapScale?: number;
  /** Where the map's centre sits, as shares of the canvas. */
  mapX?: number;
  mapY?: number;
  /** Radius of the cursor's light, CSS pixels. */
  radius?: number;
  className?: string;
}

/** The land mask as 0/1 per texel, unpacked once per page. */
let MASK: Uint8Array | null = null;
function mask(): Uint8Array {
  if (MASK) return MASK;
  const { width, height, bits } = WORLD_MASK;
  const raw = atob(bits);
  const out = new Uint8Array(width * height);
  for (let k = 0; k < out.length; k++) out[k] = (raw.charCodeAt(k >> 3) >> (k & 7)) & 1;
  return (MASK = out);
}

/** Bilinear land value at (u, v) in 0–1 map space; outside the map is sea. */
function landAt(u: number, v: number): number {
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const { width: W, height: H } = WORLD_MASK;
  const m = mask();
  const x = u * W - 0.5, y = v * H - 0.5;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  const top = m[y0 * W + x0] * (1 - fx) + m[y0 * W + x1] * fx;
  const bot = m[y1 * W + x0] * (1 - fx) + m[y1 * W + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/** An integer hash → 0–1 for the per-cell seeds. A float hash over integer
 *  cell coordinates repeats every few dozen columns and draws visible streaks. */
const seed = (x: number, y: number, s: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

function monoFont(): string {
  try {
    const v = getComputedStyle(document.body).getPropertyValue('--font-geist-mono').trim();
    return v ? `${v}, ui-monospace, monospace` : 'ui-monospace, SFMono-Regular, Menlo, monospace';
  } catch { return 'ui-monospace, monospace'; }
}

export default function GlyphField({
  ink = '161,161,170', base = 0.22, sea = 0.06, cell = 12, map = true,
  mapScale = 1.08, mapX = 0.5, mapY = 0.42, radius = 150, className,
}: GlyphFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = (canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true })
      || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link');
    } catch (e) {
      console.warn('[GlyphField] WebGL program failed — drawing nothing.', e);
      return;
    }
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = {
      res: U('uRes'), cell: U('uCell'), time: U('uTime'), mouse: U('uMouse'), hover: U('uHover'), radius: U('uRadius'),
      rip: U('uRip[0]'), ink: U('uInk'), base: U('uBase'), sea: U('uSea'), useMap: U('uUseMap'), atlas: U('uAtlas'),
    };
    const aCell = gl.getAttribLocation(prog, 'aCell');
    const aSeed = gl.getAttribLocation(prog, 'aSeed');
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aCell);
    gl.vertexAttribPointer(aCell, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(aSeed);
    gl.vertexAttribPointer(aSeed, 3, gl.FLOAT, false, 20, 8);
    let cells = 0;

    const atlasTex = gl.createTexture();
    let cellPx = 0;
    // The glyph atlas is drawn at the DEVICE cell size, so one atlas texel is
    // one screen pixel: crisp glyphs with nearest filtering, no blur.
    const buildAtlas = (px: number) => {
      const c = document.createElement('canvas');
      c.width = c.height = px * ATLAS_COLS;
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = `500 ${Math.round(px * 0.72)}px ${monoFont()}`;
      for (let i = 0; i < GLYPHS.length; i++) {
        x.fillText(GLYPHS[i], (i % ATLAS_COLS + 0.5) * px, (Math.floor(i / ATLAS_COLS) + 0.54) * px);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(u.atlas, 0);
    };

    const [ir, ig, ib] = ink.split(',').map((v) => Math.max(0, Math.min(255, Number(v) || 0)) / 255);
    gl.uniform3f(u.ink, ir, ig, ib);
    gl.uniform1f(u.base, base);
    gl.uniform1f(u.sea, sea);
    gl.uniform1f(u.useMap, map ? 1 : 0);
    const maxPoint = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null)?.[1] || 64;

    let dpr = 1, w = 0, h = 0, gridKey = '';
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Cap the backing store (~4.5 MP): past that the GPU fills pixels
      // nobody can tell apart from half as many.
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      while (rect.width * rect.height * dpr * dpr > 4.5e6 && dpr > 1) dpr -= 0.25;
      w = Math.max(1, Math.round(rect.width * dpr));
      h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      const px = Math.min(maxPoint, Math.max(6, Math.round(cell * dpr)));
      if (px !== cellPx) { cellPx = px; buildAtlas(px); }
      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.cell, cellPx);
      gl.uniform1f(u.radius, radius * dpr);

      // The grid: one vertex per cell carrying its land value and two seeds.
      // Rebuilt only when the grid itself changes.
      const cols = Math.ceil(w / cellPx), rows = Math.ceil(h / cellPx);
      const key = `${cols}x${rows}x${cellPx}`;
      if (key === gridKey) return;
      gridKey = key;
      // The map: as wide as asked, its own aspect, centred where asked.
      const aspect = WORLD_MASK.width / WORLD_MASK.height;
      // A tall, narrow canvas (a phone) zooms in until the land fills half
      // its height, rather than showing a world the size of a stamp.
      const mw = Math.max(w * mapScale, h * aspect * 0.5);
      const mh = mw / aspect;
      const mx = w * mapX - mw / 2, my = h * mapY - mh / 2;
      const data = new Float32Array(cols * rows * 5);
      let k = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = (c + 0.5) * cellPx, cy = (r + 0.5) * cellPx;
          data[k++] = c; data[k++] = r;
          data[k++] = map ? landAt((cx - mx) / mw, (cy - my) / mh) : 0;
          data[k++] = seed(c, r, 1);
          data[k++] = seed(c, r, 2);
        }
      }
      cells = cols * rows;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    };

    // Pointer state, in device pixels relative to the canvas.
    const mouse = { x: -9999, y: -9999, inside: false, travelled: 0 };
    let hover = 0;
    const ripples = new Float32Array(MAX_RIPPLES * 4);
    let nextRipple = 0;
    const t0 = performance.now();
    const now = () => (reduced ? 0 : (performance.now() - t0) / 1000);
    const addRipple = (x: number, y: number, strength: number) => {
      if (reduced) return;
      const k = (nextRipple++ % MAX_RIPPLES) * 4;
      ripples[k] = x; ripples[k + 1] = y; ripples[k + 2] = now(); ripples[k + 3] = strength;
    };
    const toLocal = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
    };
    let pending = 0;
    const requestDraw = () => { if (!pending) pending = requestAnimationFrame(() => { pending = 0; hover = mouse.inside ? 1 : 0; draw(); }); };
    const onMove = (e: PointerEvent) => {
      const p = toLocal(e);
      mouse.inside = p.inside;
      if (!p.inside) return;
      mouse.travelled += Math.hypot(p.x - mouse.x, p.y - mouse.y) / dpr;
      mouse.x = p.x; mouse.y = p.y;
      // A faint ring every ~90 px of travel: a wake, not a trail of noise.
      if (mouse.travelled > 90) { mouse.travelled = 0; addRipple(p.x, p.y, 0.32); }
      if (reduced) requestDraw();
    };
    const onDown = (e: PointerEvent) => { const p = toLocal(e); if (p.inside) { mouse.x = p.x; mouse.y = p.y; addRipple(p.x, p.y, 0.9); } };
    const onLeave = () => { mouse.inside = false; };

    let raf = 0, running = false, visible = true;
    const draw = () => {
      hover += ((mouse.inside ? 1 : 0) - hover) * 0.08;
      gl.uniform1f(u.time, now());
      gl.uniform2f(u.mouse, mouse.x, mouse.y);
      gl.uniform1f(u.hover, hover);
      gl.uniform4fv(u.rip, ripples);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, cells);
    };
    const loop = () => {
      raf = 0;
      if (!running || !visible || document.hidden) return;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => { if (reduced) return; running = true; if (!raf) raf = requestAnimationFrame(loop); };
    resize();
    draw();   // the first frame now; the loop waits for the page to settle

    const ro = new ResizeObserver(() => { resize(); if (!running) requestDraw(); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && running && !raf) raf = requestAnimationFrame(loop); });
    io.observe(canvas);
    const onVis = () => { if (!document.hidden && running && !raf) raf = requestAnimationFrame(loop); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);

    // Fonts first (the atlas is drawn in Geist Mono), then the loop after load + idle.
    let idle = 0;
    const kick = () => {
      document.fonts?.ready.then(() => { cellPx = 0; resize(); if (!running) requestDraw(); }, () => {});
      const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: any) => number);
      idle = ric ? ric(start, { timeout: 1500 }) : window.setTimeout(start, 300);
    };
    if (document.readyState === 'complete') kick(); else window.addEventListener('load', kick, { once: true });

    const onLost = (e: Event) => { e.preventDefault(); running = false; };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      if (pending) cancelAnimationFrame(pending);
      const cic = (window as any).cancelIdleCallback as undefined | ((n: number) => void);
      if (cic) cic(idle); else clearTimeout(idle);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('load', kick);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      gl.deleteTexture(atlasTex); gl.deleteBuffer(buf); gl.deleteProgram(prog);
    };
  }, [ink, base, sea, cell, map, mapScale, mapX, mapY, radius]);

  return <canvas ref={ref} aria-hidden="true" className={className} style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />;
}
