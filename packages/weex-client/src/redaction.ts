const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "apikey",
  "secretkey",
  "passphrase",
  "access-key",
  "access-sign",
  "access-passphrase",
  "authorization",
  "signature",
]);

export function redactSensitive<T>(input: T): T {
  const clones = new WeakMap<object, unknown>();

  function clone(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;

    const existing = clones.get(value);
    if (existing !== undefined) return existing;

    if (Array.isArray(value)) {
      const result: unknown[] = new Array(value.length);
      clones.set(value, result);
      for (let index = 0; index < value.length; index += 1) {
        if (index in value) result[index] = clone(value[index]);
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    clones.set(value, result);
    for (const [key, child] of Object.entries(value)) {
      result[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : clone(child);
    }
    return result;
  }

  return clone(input) as T;
}
