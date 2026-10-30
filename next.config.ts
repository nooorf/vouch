import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off on purpose: almost every Vouch page shows live, per-person data (job state, money held),
  // so a prerendered static shell buys little and every session read would need its own
  // Suspense boundary. Pages that read cookies or the database render per request.
  cacheComponents: false,
  // Demo delivery sites live in public/demo-sites. Redirect (not rewrite) so their relative links resolve.
  async redirects() {
    return [{ source: "/demo-sites/:site(good|flawed|fixed|hostile)", destination: "/demo-sites/:site/index.html", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
