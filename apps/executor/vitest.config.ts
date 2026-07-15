import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  resolve: { alias: {
    "@cryptobot-labs/weex-client": new URL("../../packages/weex-client/src/index.ts", import.meta.url).pathname,
    "@cryptobot-labs/trading-core": new URL("../../packages/trading-core/src/index.ts", import.meta.url).pathname,
  } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
