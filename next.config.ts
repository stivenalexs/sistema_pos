import type { NextConfig } from "next";

// Product photos come from the public Supabase Storage bucket (D-047). Only
// that bucket path is allowed for next/image.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const isLocalSupabase =
  supabaseUrl !== null && ["127.0.0.1", "localhost"].includes(supabaseUrl.hostname);

const nextConfig: NextConfig = {
  // Do not let `next dev` write its managed block into AGENTS.md: on Windows
  // that file is the same as the project's agents.md (D-029).
  agentRules: false,
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: supabaseUrl.protocol === "https:" ? "https" : "http",
            hostname: supabaseUrl.hostname,
            port: supabaseUrl.port,
            pathname: "/storage/v1/object/public/product-images/**",
          },
        ]
      : [],
    // Next 16 refuses to optimize images from local IPs. Allowed only when
    // Supabase itself runs locally (development), never for a hosted project.
    dangerouslyAllowLocalIP: isLocalSupabase,
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
