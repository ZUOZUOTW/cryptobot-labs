import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    lib: { entry: "src/preload/index.ts", formats: ["cjs"], fileName: () => "preload.cjs" },
    rollupOptions: { output: { entryFileNames: "preload.cjs", format: "cjs" } },
  },
});
