import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const middlewareBundle = resolve(".next/server/middleware.js");
const forbiddenDependencies = [
  "@jitl/quickjs-singlefile-cjs-release-sync",
  "quickjs-emscripten-core",
];

let source;
try {
  source = await readFile(middlewareBundle, "utf8");
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Edge bundle check failed: cannot read ${middlewareBundle}: ${reason}`);
  process.exit(1);
}

const bundled = forbiddenDependencies.filter((dependency) => source.includes(dependency));
if (bundled.length > 0) {
  console.error(
    `Edge bundle check failed: middleware includes Node-only trading sandbox dependencies: ${bundled.join(", ")}`,
  );
  process.exit(1);
}

console.log("Edge bundle check passed: middleware excludes Node-only trading sandbox dependencies.");
