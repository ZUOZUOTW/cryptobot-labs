import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "cloudflare:workers": new URL("./tests/cloudflare-workers.ts", import.meta.url).pathname } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "packages/*/tests/**/*.test.{ts,tsx}"],
  },
});
