/** @type {import('next').NextConfig} */
const nextConfig = {
  // Traced output for the Docker image: Next copies only the node_modules the
  // server actually reaches, turning a ~700 MB install into a ~150 MB layer.
  // Harmless on Render, which runs `next start` against .next as usual.
  output: 'standalone',
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
  /**
   * Privy reaches for wallet connectors it does not depend on.
   *
   * From 3.36 its bundle references `@farcaster/mini-app-solana`, which is an
   * OPTIONAL peer it never installs. Webpack resolves imports statically, so it
   * fails the whole build on a module that only matters to apps using Farcaster
   * mini-apps — which this is not. `false` tells webpack to resolve it to an
   * empty module rather than error, the same treatment the pino-pretty warnings
   * already get from webpack's own optional handling.
   *
   * This is why merging that bump on its own broke the Render deploy: it
   * installs clean and fails at build, so npm gives no warning at all.
   */
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@farcaster/mini-app-solana': false,
    };
    return config;
  },
  experimental: {
    // pdfkit must stay unbundled: it reads its font metrics from node_modules at
    // runtime. @firecrawl/pdf-inspector is a native .node addon, which webpack
    // cannot bundle at all — it has to be required from node_modules.
    serverComponentsExternalPackages: ['googleapis', 'pdfkit', '@firecrawl/pdf-inspector'],
    // `output: 'standalone'` traces which node_modules to copy by FOLLOWING
    // imports, and the addon is loaded through a guarded require() inside a
    // try/catch — exactly the shape a static tracer can miss. Naming it here
    // means the Docker image gets the binary rather than silently falling back
    // to text-only extraction in production and nowhere else.
    outputFileTracingIncludes: {
      '/api/files/extract': ['./node_modules/@firecrawl/pdf-inspector*/**'],
    },
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
