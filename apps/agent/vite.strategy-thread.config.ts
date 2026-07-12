import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      entry: "src/runtime/strategy-thread.ts",
      formats: ["cjs"],
      fileName: () => "strategy-thread.cjs",
    },
  },
});
