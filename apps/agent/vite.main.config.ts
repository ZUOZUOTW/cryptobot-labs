import { defineConfig } from "vite";

export default defineConfig({
  define: { __CBL_CONTROL_PLANE_ORIGIN__: JSON.stringify(process.env.CBL_CONTROL_PLANE_ORIGIN ?? "") },
  build: { sourcemap: true, lib: { entry: "src/main/index.ts", formats: ["cjs"], fileName: () => "main.cjs" } },
});
