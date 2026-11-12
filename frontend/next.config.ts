import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Isolate browser QA/build output from an already-running development server.
  distDir: process.env.WMS_QA === "1" ? ".next-qa" : ".next",
  cacheComponents: true,
  partialPrefetching: true,
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
