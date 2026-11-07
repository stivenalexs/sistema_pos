import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    // Pure domain and server tests run in Node. Component tests opt in to a
    // browser-like DOM with a `// @vitest-environment jsdom` comment.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
