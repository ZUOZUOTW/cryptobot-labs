import postgres, { type Sql } from "postgres";
import type { ControlPlaneDatabase, ControlPlaneRunResult, ControlPlaneStatement } from "../../db";

type AnySql = Sql<{ bigint: number }>;
type QueryClient = Pick<AnySql, "unsafe">;
type QueryResult = unknown[] & { count?: number };
type ClientRegistry = Map<string, AnySql>;
type RegistryGlobal = typeof globalThis & { cryptobotPostgresServerlessClients?: ClientRegistry };

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
    return client.unsafe(positionalSql(this.sql), this.bindings as never[]) as Promise<QueryResult>;
  }

  async first<T>(): Promise<T | null> {
    return (await this.query())[0] as T | undefined ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: await this.query() as T[], success: true };
  }

  async run(): Promise<ControlPlaneRunResult> {
    const result = await this.database.client.unsafe(positionalSql(this.sql), this.bindings as never[]);
    return { success: true, meta: { changes: result.count } };
  }
}

export class PostgresControlPlaneDatabase implements ControlPlaneDatabase {
  constructor(readonly client: AnySql) {}

  prepare(sql: string): ControlPlaneStatement {
    return new PostgresStatement(this, sql);
  }

  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
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

export const createPostgresControlPlaneDatabase = (databaseUrl: unknown): ControlPlaneDatabase => {
  if (typeof databaseUrl !== "string" || !/^postgres(?:ql)?:\/\/.+/.test(databaseUrl)) {
    throw new Error("A D1-compatible control-plane binding or Supabase DATABASE_URL is required");
  }
  const parsed = new URL(databaseUrl);
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
  return new PostgresControlPlaneDatabase(client);
};
