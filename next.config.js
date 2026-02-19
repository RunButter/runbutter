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
  // googleapis uses Node.js built-ins — keep it server-side only
  serverExternalPackages: ['googleapis'],
};

module.exports = nextConfig;
