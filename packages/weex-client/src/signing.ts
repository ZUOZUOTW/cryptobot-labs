export type QueryEntry = readonly [key: string, value: string];

export interface SigningInput {
  timestamp: string;
  method: "GET" | "POST" | "DELETE" | "get" | "post" | "delete";
  requestPath: string;
  query: string;
  body: string;
}

export interface PrivateHeaderInput {
  apiKey: string;
  passphrase: string;
  timestamp: string;
  signature: string;
}

const OMIT = Symbol("omit-from-json");

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function compareEncoded(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function canonicalQuery(entries: Iterable<QueryEntry>): string {
  return Array.from(entries, ([key, value], index) => ({
    key: encodeRfc3986(key),
    value: encodeRfc3986(value),
    index,
  }))
    .sort(
      (left, right) =>
        compareEncoded(left.key, right.key) ||
        compareEncoded(left.value, right.value) ||
        left.index - right.index,
    )
    .map(({ key, value }) => `${key}=${value}`)
    .join("&");
}

function canonicalize(value: unknown, ancestors: Set<object>): unknown | typeof OMIT {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON requires finite numbers");
    }
    return value;
  }

  if (typeof value === "bigint") {
    throw new TypeError("Canonical JSON does not support bigint values");
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return OMIT;
  }

  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not support cyclic structures");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const canonical = canonicalize(item, ancestors);
        return canonical === OMIT ? null : canonical;
      });
    }

    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const canonical = canonicalize((value as Record<string, unknown>)[key], ancestors);
      if (canonical !== OMIT) {
        result[key] = canonical;
      }
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  const canonical = canonicalize(value, new Set());
  if (canonical === OMIT) {
    throw new TypeError("Canonical JSON requires a serializable root value");
  }
  return JSON.stringify(canonical);
}

export function buildSignaturePayload(input: SigningInput): string {
  if (!/^(?:GET|POST|DELETE)$/i.test(input.method)) {
    throw new TypeError("Unsupported HTTP method for WEEX signing");
  }
  if (!/^\d+$/.test(input.timestamp)) {
    throw new TypeError("Timestamp must be a non-empty millisecond digit string");
  }
  if (!/^\/(?!\/)[^\s?#]*$/.test(input.requestPath)) {
    throw new TypeError("Request path must be an absolute path without query or fragment");
  }
  if (input.query.startsWith("?")) {
    throw new TypeError("Canonical query must not start with a question mark");
  }

  const query = input.query ? `?${input.query}` : "";
  return `${input.timestamp}${input.method.toUpperCase()}${input.requestPath}${query}${input.body}`;
}

export async function signWeexRequest(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function buildPrivateHeaders(input: PrivateHeaderInput): Record<string, string> {
  return {
    "ACCESS-KEY": input.apiKey,
    "ACCESS-SIGN": input.signature,
    "ACCESS-PASSPHRASE": input.passphrase,
    "ACCESS-TIMESTAMP": input.timestamp,
    "Content-Type": "application/json",
  };
}
