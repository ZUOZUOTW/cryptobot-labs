import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const nextOutput = resolve(projectRoot, ".next");

if (nextOutput !== `${projectRoot}/.next`) {
  throw new Error("Refusing to clean a Next.js output directory outside the project root.");
}

await rm(nextOutput, { force: true, recursive: true });
console.log("Cleared the local .next output so Netlify builds CSS and fonts from current sources.");
