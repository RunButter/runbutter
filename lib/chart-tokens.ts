'use client';

import { useEffect, useState } from 'react';

// Chart.js paints to a <canvas>, and canvas does NOT resolve CSS custom
// properties — handing it `hsl(var(--accent))` silently yields black, which is
// invisible in dark mode. Resolve the design tokens to concrete colours here
// instead, and recompute whenever the theme class flips on <html>.
//
// Shared by every Chart.js surface (candidate report, team-fit radar) so the
// charts cannot drift apart. SVG charts don't need this — they inherit CSS
// vars natively (see components/crm/FinanceChart.tsx).
export type ChartTokens = {
    accent: string; accentFill: string;
    success: string; successFill: string;
    grid: string; label: string;
    surface: string; title: string;
    body: string; border: string;
};

const read = (): ChartTokens => {
    const cs = getComputedStyle(document.documentElement);
    const raw = (n: string) => cs.getPropertyValue(n).trim();
    const hsl = (n: string, a = 1) => `hsl(${raw(n)} / ${a})`;
    return {
        accent: hsl('--accent'), accentFill: hsl('--accent', 0.18),
        success: hsl('--success', 0.5), successFill: hsl('--success', 0.06),
        grid: hsl('--border-subtle'), label: hsl('--text-tertiary'),
        surface: hsl('--surface'), title: hsl('--text-primary'),
        body: hsl('--text-secondary'), border: hsl('--border-strong'),
    };
};

export function useChartTokens(): ChartTokens | null {
    const [tokens, setTokens] = useState<ChartTokens | null>(null);
    useEffect(() => {
        setTokens(read());
        const obs = new MutationObserver(() => setTokens(read()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => obs.disconnect();
    }, []);
    return tokens;
}
