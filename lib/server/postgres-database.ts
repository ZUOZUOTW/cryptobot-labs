import postgres, { type Sql } from "postgres";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../../db";
import {
  assertPostgresRuntimeIdentity,
  POSTGRES_RUNTIME_IDENTITY_SQL,
} from "./postgres-runtime-readiness.js";

type AnySql = Sql<{ bigint: number }>;
type QueryClient = Pick<AnySql, "unsafe">;
type QueryResult = unknown[] & { count?: number };
type ClientRegistry = Map<string, AnySql>;
type RegistryGlobal = typeof globalThis & { cryptobotPostgresServerlessClients?: ClientRegistry };
type RuntimeDatabaseRole = "cryptobot_netlify" | "cryptobot_executor";

const identityChecks = new WeakMap<AnySql, Map<RuntimeDatabaseRole, Promise<void>>>();

const databaseRoleFromUrl = (databaseUrl: unknown): RuntimeDatabaseRole | undefined => {
  if (typeof databaseUrl !== "string" || !/^postgres(?:ql)?:\/\/.+/u.test(databaseUrl)) return undefined;
  try {
    const username = decodeURIComponent(new URL(databaseUrl).username);
    for (const role of ["cryptobot_netlify", "cryptobot_executor"] as const) {
      if (username === role || username.startsWith(`${role}.`)) return role;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const runtimeIdentityCheck = (client: AnySql, expectedRole: RuntimeDatabaseRole): Promise<void> => {
  let checks = identityChecks.get(client);
  if (!checks) {
    checks = new Map();
    identityChecks.set(client, checks);
  }
  let check = checks.get(expectedRole);
  if (!check) {
    const roleChecks = checks;
    const guarded = client.unsafe(POSTGRES_RUNTIME_IDENTITY_SQL).then((rows) => {
      assertPostgresRuntimeIdentity(rows[0], expectedRole);
    }).catch((error: unknown) => {
      // A transient connection failure must not poison a warm server instance.
      // Only successful identity evidence is cached for the client lifetime.
      if (roleChecks.get(expectedRole) === guarded) roleChecks.delete(expectedRole);
      throw error;
    });
    check = guarded;
    checks.set(expectedRole, check);
  }
  return check;
};

const clientRegistry = (): ClientRegistry => {
  const root = globalThis as RegistryGlobal;
  root.cryptobotPostgresServerlessClients ??= new Map();
  return root.cryptobotPostgresServerlessClients;
};

const quoteCamelCaseAliases = (sql: string): string =>
  sql.replace(/\bAS\s+([a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*)\b/gi, 'AS "$1"');

const positionalSql = (sql: string): string => {
  let position = 0;
  let normalized = quoteCamelCaseAliases(sql.trim().replace(/;\s*$/, ""))
    .replace(/\?/g, () => `$${++position}`);
  if (/^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(normalized)) {
    normalized = normalized.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO");
    normalized += " ON CONFLICT DO NOTHING";
  }
  return normalized;
};

class PostgresStatement implements ControlPlaneStatement {
  private bindings: unknown[] = [];

  constructor(private readonly database: PostgresControlPlaneDatabase, readonly sql: string) {}

  bind(...values: unknown[]): ControlPlaneStatement {
    this.bindings = values;
    return this;
  }

  async query(client: QueryClient = this.database.client): Promise<QueryResult> {
    await this.database.assertReady();
    return client.unsafe(positionalSql(this.sql), this.bindings as never[]) as Promise<QueryResult>;
  }

  async first<T>(): Promise<T | null> {
    return (await this.query())[0] as T | undefined ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: await this.query() as T[], success: true };
  }

  async run(): Promise<ControlPlaneRunResult> {
    const result = await this.query();
    return { success: true, meta: { changes: result.count } };
  }
}

export class PostgresControlPlaneDatabase implements ControlPlaneDatabase {
  readonly dialect = "postgres" as const;

  constructor(readonly client: AnySql, private readonly expectedRuntimeRole?: RuntimeDatabaseRole) {}

  async assertReady(): Promise<void> {
    if (this.expectedRuntimeRole) await runtimeIdentityCheck(this.client, this.expectedRuntimeRole);
  }

  prepare(sql: string): ControlPlaneStatement {
    return new PostgresStatement(this, sql);
  }

  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    await this.assertReady();
    return this.client.begin(async (transaction) => {
      const results: ControlPlaneRunResult[] = [];
      for (const statement of statements) {
        if (!(statement instanceof PostgresStatement)) throw new TypeError("Postgres batch received an incompatible statement");
        const result = await statement.query(transaction);
        results.push({ success: true, meta: { changes: result.count ?? 0 } });
      }
      return results;
    }) as Promise<ControlPlaneRunResult[]>;
  }
}

export const createPostgresControlPlaneDatabase = (
  databaseUrl: unknown,
  expectedRuntimeRole?: RuntimeDatabaseRole,
): ControlPlaneDatabase => {
  if (typeof databaseUrl !== "string" || !/^postgres(?:ql)?:\/\/.+/u.test(databaseUrl)) {
    throw new Error("A D1-compatible control-plane binding or Supabase DATABASE_URL is required");
  }
  const parsed = new URL(databaseUrl);
  const configuredRole = databaseRoleFromUrl(databaseUrl);
  if (expectedRuntimeRole && configuredRole !== expectedRuntimeRole) {
    throw new Error(`Supabase DATABASE_URL must use the ${expectedRuntimeRole} runtime role`);
  }
  if (parsed.hostname.endsWith(".pooler.supabase.com") && (parsed.port === "" || parsed.port === "5432")) {
    parsed.port = "6543";
  }
  const normalizedUrl = parsed.toString();
  const bigint = { to: 20, from: [20], serialize: (value: number) => String(value), parse: (value: string) => Number(value) };
  const registry = clientRegistry();
  let client = registry.get(normalizedUrl);
  if (!client) {
    client = postgres(normalizedUrl, {
      max: 2,
      idle_timeout: 10,
      connect_timeout: 10,
      max_lifetime: 600,
      prepare: false,
      ssl: "require",
      types: { bigint },
    });
    registry.set(normalizedUrl, client);
  }
  return new PostgresControlPlaneDatabase(client, expectedRuntimeRole);
};
