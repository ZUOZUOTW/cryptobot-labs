import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type BaselineEntry = {
  version: string;
  name: string;
  normalizedSha256: string;
};

type ProductionBaseline = {
  projectRef: string;
  capturedAt: string;
  migrations: BaselineEntry[];
  pendingMigrations: BaselineEntry[];
};

const migrationsDirectory = path.join("supabase", "migrations");
const baselinePath = path.join("supabase", "production-migration-baseline.json");

describe("Supabase production migration baseline", () => {
  it("matches every canonical production migration by version and SQL hash", async () => {
    const baseline = JSON.parse(
      await readFile(baselinePath, "utf8"),
    ) as ProductionBaseline;
    const appliedFiles = baseline.migrations.map(
      ({ version, name }) => `${version}_${name}.sql`,
    );
    const pendingFiles = baseline.pendingMigrations.map(
      ({ version, name }) => `${version}_${name}.sql`,
    );
    const expectedFiles = [...appliedFiles, ...pendingFiles];
    const actualFiles = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    expect(baseline.projectRef).toBe("production-project-redacted");
    expect(baseline.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(appliedFiles).toEqual([...appliedFiles].sort());
    expect(pendingFiles).toEqual([...pendingFiles].sort());
    expect(baseline.pendingMigrations.every(({ version }) => (
      version > baseline.migrations.at(-1)!.version
    ))).toBe(true);
    expect(new Set(expectedFiles).size).toBe(expectedFiles.length);
    expect(actualFiles).toEqual(expectedFiles);

    for (const [index, migration] of expectedFiles.map((file) => {
      const entry = [...baseline.migrations, ...baseline.pendingMigrations]
        .find(({ version, name }) => file === `${version}_${name}.sql`);
      return entry!;
    }).entries()) {
      expect(migration.version).toMatch(/^\d{14}$/);
      expect(migration.name).toMatch(/^[a-z0-9_]+$/);
      expect(migration.normalizedSha256).toMatch(/^[a-f0-9]{64}$/);
      if (index > 0) {
        const previous = [...baseline.migrations, ...baseline.pendingMigrations][index - 1]!;
        expect(migration.version > previous.version).toBe(
          true,
        );
      }

      const sql = await readFile(
        path.join(
          migrationsDirectory,
          `${migration.version}_${migration.name}.sql`,
        ),
        "utf8",
      );
      const normalizedSql = sql.replace(/\n+$/, "");
      const actualSha256 = createHash("sha256")
        .update(normalizedSql)
        .digest("hex");

      expect(actualSha256, `${migration.version}_${migration.name}`).toBe(
        migration.normalizedSha256,
      );
    }
  });
});
