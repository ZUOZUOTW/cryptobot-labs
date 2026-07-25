import { env } from "../lib/server/platform-env";
import { createPostgresControlPlaneDatabase } from "../lib/server/postgres-database";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface ControlPlaneRunResult {
  success: boolean;
  meta: { changes?: number };
}

export interface ControlPlaneStatement {
  bind(...values: unknown[]): ControlPlaneStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; success: boolean }>;
  run(): Promise<ControlPlaneRunResult>;
}

export interface ControlPlaneDatabase {
  prepare(sql: string): ControlPlaneStatement;
  batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]>;
}

type D1Binding = Parameters<typeof drizzle>[0];

export function createDb(binding: D1Binding) {
  return drizzle(binding, { schema });
}

/** Narrows a real D1 binding to the intentionally small repository surface. */
export function createControlPlaneDatabase(
  binding: unknown,
  databaseUrl: unknown = env.SUPABASE_DATABASE_URL ?? env.DATABASE_URL,
): ControlPlaneDatabase {
  if (binding === null || typeof binding !== "object"
    || typeof (binding as { prepare?: unknown }).prepare !== "function"
    || typeof (binding as { batch?: unknown }).batch !== "function") {
    return createPostgresControlPlaneDatabase(databaseUrl);
  }
  return binding as ControlPlaneDatabase;
}

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "A D1-compatible control-plane binding or server-side Supabase DATABASE_URL is required."
    );
  }

  return createDb(env.DB);
}
