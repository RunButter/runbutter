/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  transpilePackages: ['@privy-io/react-auth'],
  experimental: {
    // pdfkit must stay unbundled: it reads its font metrics from node_modules at runtime
    serverComponentsExternalPackages: ['googleapis', 'pino', 'pino-pretty', 'pdfkit'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Baseline security headers + CSP. The CSP ships REPORT-ONLY first: watch
  // the browser console / reports in prod for a few days, then rename the key
  // to 'Content-Security-Policy' to enforce. 'unsafe-inline' stays until Next
  // inline scripts get nonces; 'unsafe-eval' is dev-only (webpack HMR).
  async headers() {
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://auth.privy.io https://*.privy.io",
      "frame-src https://auth.privy.io https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
