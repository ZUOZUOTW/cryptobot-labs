export interface RuntimeCredentials {
  apiKey: string;
  secretKey: string;
  passphrase: string;
}

export type RuntimeCommand =
  | {
      type: "start";
      requestId: string;
      credentials: RuntimeCredentials;
      runId?: string;
    }
  | { type: "stop"; requestId: string }
  | { type: "emergency-stop"; requestId: string };

export type RuntimeEvent =
  | { type: "ready"; requestId: string }
  | { type: "stopped"; requestId: string }
  | { type: "heartbeat"; at: number }
  | { type: "status"; state: "idle" | "running" | "stopping" }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "error"; code: string; message: string; fatal: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isBoundedString(value: unknown, max = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isRequestId(value: unknown): value is string {
  return isBoundedString(value, 128) && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function isCredentials(value: unknown): value is RuntimeCredentials {
  if (!isRecord(value) || !hasOnlyKeys(value, ["apiKey", "secretKey", "passphrase"])) return false;
  return (
    isBoundedString(value.apiKey) &&
    isBoundedString(value.secretKey) &&
    isBoundedString(value.passphrase)
  );
}

export function parseRuntimeCommand(value: unknown): RuntimeCommand | null {
  try {
    if (!isRecord(value) || typeof value.type !== "string") return null;
    if (value.type === "start") {
      if (!hasOnlyKeys(value, ["type", "requestId", "credentials", "runId"])) return null;
      if (!isRequestId(value.requestId) || !isCredentials(value.credentials)) return null;
      if (value.runId !== undefined && !isBoundedString(value.runId, 128)) return null;
      return {
        type: "start",
        requestId: value.requestId,
        credentials: {
          apiKey: value.credentials.apiKey,
          secretKey: value.credentials.secretKey,
          passphrase: value.credentials.passphrase,
        },
        ...(value.runId === undefined ? {} : { runId: value.runId }),
      };
    }
    if (value.type === "stop" || value.type === "emergency-stop") {
      if (!hasOnlyKeys(value, ["type", "requestId"]) || !isRequestId(value.requestId)) return null;
      return { type: value.type, requestId: value.requestId };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseRuntimeEvent(value: unknown): RuntimeEvent | null {
  try {
    if (!isRecord(value) || typeof value.type !== "string") return null;
    if (value.type === "ready" || value.type === "stopped") {
      if (!hasOnlyKeys(value, ["type", "requestId"]) || !isRequestId(value.requestId)) return null;
      return value as RuntimeEvent;
    }
    if (value.type === "heartbeat") {
      if (!hasOnlyKeys(value, ["type", "at"]) || typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
      return value as RuntimeEvent;
    }
    if (value.type === "status") {
      if (!hasOnlyKeys(value, ["type", "state"]) || !["idle", "running", "stopping"].includes(String(value.state))) return null;
      return value as RuntimeEvent;
    }
    if (value.type === "log") {
      if (!hasOnlyKeys(value, ["type", "level", "message"])) return null;
      if (!["info", "warn", "error"].includes(String(value.level)) || !isBoundedString(value.message, 8192)) return null;
      return value as RuntimeEvent;
    }
    if (value.type === "error") {
      if (!hasOnlyKeys(value, ["type", "code", "message", "fatal"])) return null;
      if (!isBoundedString(value.code, 128) || !isBoundedString(value.message, 8192) || typeof value.fatal !== "boolean") return null;
      return value as RuntimeEvent;
    }
    return null;
  } catch {
    return null;
  }
}

const SECRET_KEY = /(?:api.?key|secret|passphrase|authorization|signature|credential)/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const REDACTION_LIMIT = "[REDACTION_LIMIT]";
const REDACTION_MAX_DEPTH = 12;
const REDACTION_MAX_NODES = 1_000;
const REDACTION_MAX_STRING = 65_536;
const REDACTION_MAX_SECRETS = 32;

function createStringRedactor(knownSecrets: readonly string[]): (value: string) => string {
  if (
    knownSecrets.length > REDACTION_MAX_SECRETS ||
    knownSecrets.some((secret) => typeof secret !== "string" || secret.length > 4_096)
  ) {
    return () => REDACTION_LIMIT;
  }
  const secrets = [...new Set(knownSecrets.filter((secret) => secret.length > 0))]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const alternatives = ["\\bBearer\\s+[A-Za-z0-9._~+/=-]+", ...secrets];
  const matcher = new RegExp(alternatives.join("|"), "gi");
  return (value) => {
    if (value.length > REDACTION_MAX_STRING) return REDACTION_LIMIT;
    matcher.lastIndex = 0;
    return value.replace(matcher, (match) =>
      /^Bearer\s/i.test(match) ? "Bearer [REDACTED]" : "[REDACTED]",
    );
  };
}

export function redactCredentialMaterial(value: unknown, knownSecrets: readonly string[] = []): unknown {
  const seen = new WeakSet<object>();
  const redactString = createStringRedactor(knownSecrets);
  let nodes = 0;

  const visit = (item: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > REDACTION_MAX_NODES || depth > REDACTION_MAX_DEPTH) return REDACTION_LIMIT;
    if (typeof item === "string") return redactString(item);
    if (item === null || typeof item === "number" || typeof item === "boolean" || item === undefined) return item;
    if (typeof item === "bigint" || typeof item === "symbol" || typeof item === "function") return REDACTION_LIMIT;
    if (typeof item !== "object") return REDACTION_LIMIT;
    if (seen.has(item)) return REDACTION_LIMIT;
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > REDACTION_MAX_NODES - nodes) return REDACTION_LIMIT;
        return item.map((entry) => visit(entry, depth + 1));
      }
      if (item instanceof Error) {
        return { name: redactString(item.name), message: redactString(item.message) };
      }
      const redacted: Record<string, unknown> = {};
      const entries = Object.entries(item);
      if (entries.length > REDACTION_MAX_NODES - nodes) return REDACTION_LIMIT;
      for (const [key, entry] of entries) {
        redacted[key] = SECRET_KEY.test(key) ? "[REDACTED]" : visit(entry, depth + 1);
      }
      return redacted;
    } catch {
      return REDACTION_LIMIT;
    }
  };

  try {
    return visit(value, 0);
  } catch {
    return REDACTION_LIMIT;
  }
}
