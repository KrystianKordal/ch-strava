/** @type {import('next').NextConfig} */
const nextConfig = {
  // legacy-php to tylko referencja — niech nie wchodzi do builda.
  outputFileTracingExcludes: {
    '*': ['./legacy-php/**'],
  },
};

export default nextConfig;
