const nextConfig = {
  transpilePackages: ["wagmi", "@wagmi/core", "@tanstack/react-query", "@tanstack/query-core"],
  experimental: {
    optimizePackageImports: ["wagmi", "@wagmi/core", "@tanstack/react-query"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
