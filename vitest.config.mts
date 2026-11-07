import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside Next's server bundle; tests run in plain
    // Node, so it is replaced with an empty module here.
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/empty-module.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Pure domain and server tests run in Node. Component tests opt in to a
    // browser-like DOM with a `// @vitest-environment jsdom` comment.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
