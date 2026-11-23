/** @type {import('next').NextConfig} */
module.exports = {
  devIndicators: false,
  outputFileTracingRoot: __dirname,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'image.tmdb.org', pathname: '/t/p/**' }],
  },
};
