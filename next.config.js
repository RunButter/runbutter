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
};

module.exports = nextConfig;
