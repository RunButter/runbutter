'use client';

// All Chart.js wiring in ONE module so it can be code-split away.
//
// WHY: chart.js + react-chartjs-2 is ~110 kB, and three screens imported it
// statically — so every visitor downloaded and parsed a charting library before
// they could see anything, even on pages where the chart sits below the fold or
// inside a modal that was never opened. Consumers now pull this in via
// next/dynamic({ ssr: false }), so it loads only when a chart actually renders.
//
// Registration happens once here, covering the union of what the radar
// (candidate fit), bar and pie (HR analytics) charts need.
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, RadialLinearScale,
  BarElement, PointElement, LineElement, ArcElement,
  Filler, Title, Tooltip, Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale, LinearScale, RadialLinearScale,
  BarElement, PointElement, LineElement, ArcElement,
  Filler, Title, Tooltip, Legend,
);

export { Radar, Bar, Pie } from 'react-chartjs-2';
