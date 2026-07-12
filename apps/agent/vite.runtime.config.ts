import { defineConfig } from "vite";

export default defineConfig({
  build: { sourcemap: true, lib: { entry: "src/runtime/index.ts", formats: ["cjs"], fileName: () => "runtime.cjs" } },
});
