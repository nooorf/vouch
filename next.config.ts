import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off on purpose: almost every Vouch page shows live, per-person data (job state, money held),
  // so a prerendered static shell buys little and every session read would need its own
  // Suspense boundary. Pages that read cookies or the database render per request.
  cacheComponents: false,
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
