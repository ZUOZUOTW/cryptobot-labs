#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const reviewedProductionLicenses = new Set([
  "(MIT AND Zlib)",
  "(MIT OR GPL-3.0-or-later)",
  "0BSD",
  "Apache-2.0",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "Unlicense",
]);

const output = execFileSync(
  "pnpm",
  ["licenses", "list", "--prod", "--json"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);
const inventory = JSON.parse(output);
const unexpectedLicenses = Object.keys(inventory)
  .filter((license) => !reviewedProductionLicenses.has(license))
  .sort();

if (unexpectedLicenses.length > 0) {
  throw new Error(
    `Unreviewed production dependency license(s): ${unexpectedLicenses.join(", ")}`,
  );
}

const packages = Object.values(inventory).flatMap((entries) =>
  Array.isArray(entries) ? entries : []);
const restrictedPackages = packages
  .map((entry) => entry?.name)
  .filter((name) => name === "remotion" || name === "@remotion/player");

if (restrictedPackages.length > 0) {
  throw new Error(
    `Restricted source-available package reintroduced: ${restrictedPackages.join(", ")}`,
  );
}

process.stdout.write(
  `Reviewed ${packages.length} production package license entries across ${Object.keys(inventory).length} license groups.\n`,
);
