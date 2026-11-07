import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Do not let `next dev` write its managed block into AGENTS.md: on Windows
  // that file is the same as the project's agents.md (D-029).
  agentRules: false,
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
