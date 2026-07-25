const encoder = new TextEncoder();

/** Hashes the exact UTF-8 script bytes recorded by the execution audit trail. */
export async function sha256ScriptHash(source: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
