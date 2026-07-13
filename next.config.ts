import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Keep QuickJS' embedded WASM binary out of webpack's generated template strings. */
  serverExternalPackages: [
    "@jitl/quickjs-singlefile-cjs-release-sync",
    "quickjs-emscripten-core",
  ],
  webpack(config, { isServer }) {
    if (isServer) {
      config.externals.push({
        "@jitl/quickjs-singlefile-cjs-release-sync": "commonjs @jitl/quickjs-singlefile-cjs-release-sync",
        "quickjs-emscripten-core": "commonjs quickjs-emscripten-core",
      });
    }
    return config;
  },
};

export default nextConfig;
