const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const VALUE = /^[A-Za-z0-9._:-]+$/;
const HASH = /^[A-Za-z0-9_-]{43}$/;
const RETURN_TO = /^\/(?!\/)[^\u0000-\u001f\u007f]{0,1023}$/;

export interface ExecutorOAuthHandoff {
  readonly version: 1;
  readonly audience: "cryptobot-labs-weex-oauth";
  readonly action: "connect";
  readonly userId: string;
  readonly sessionHash: string;
  readonly nonce: string;
  readonly returnTo: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("Invalid OAuth handoff encoding");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(padded);
  const result = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) result[index] = decoded.charCodeAt(index);
  return result;
}

function validate(payload: ExecutorOAuthHandoff, now: number): ExecutorOAuthHandoff {
  const keys = Object.keys(payload).sort().join(",");
  if (keys !== "action,audience,expiresAt,issuedAt,nonce,returnTo,sessionHash,userId,version"
    || payload.version !== 1 || payload.audience !== "cryptobot-labs-weex-oauth" || payload.action !== "connect"
    || !VALUE.test(payload.userId) || payload.userId.length > 128 || !HASH.test(payload.sessionHash)
    || !HASH.test(payload.nonce) || !RETURN_TO.test(payload.returnTo)
    || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)
    || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > 120_000
    || payload.issuedAt > now + 30_000 || payload.expiresAt <= now) {
    throw new TypeError("Invalid or expired OAuth handoff");
  }
  return Object.freeze(payload);
}

async function hmac(secret: string, payload: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  if (encoder.encode(secret).byteLength < 32 || secret.length > 512) throw new TypeError("Invalid OAuth handoff secret");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function sha256Base64Url(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function createExecutorOAuthHandoff(input: {
  readonly userId: string;
  readonly sessionHash: string;
  readonly returnTo: string;
  readonly secret: string;
  readonly now?: number;
  readonly crypto?: Pick<Crypto, "getRandomValues">;
}): Promise<string> {
  const now = input.now ?? Date.now();
  const nonceBytes = new Uint8Array(32);
  (input.crypto ?? crypto).getRandomValues(nonceBytes);
  const payload = validate({ version: 1, audience: "cryptobot-labs-weex-oauth", action: "connect",
    userId: input.userId, sessionHash: input.sessionHash, nonce: base64Url(nonceBytes), returnTo: input.returnTo,
    issuedAt: now, expiresAt: now + 60_000 }, now);
  const encoded = base64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmac(input.secret, encoded, "sign");
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(encoded))));
  return `${encoded}.${signature}`;
}

export async function verifyExecutorOAuthHandoff(token: string, secret: string, now = Date.now()): Promise<ExecutorOAuthHandoff> {
  if (token.length > 4_096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new TypeError("Invalid OAuth handoff");
  }
  const [encoded, signature] = token.split(".") as [string, string];
  const key = await hmac(secret, encoded, "verify");
  const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(signature), encoder.encode(encoded));
  if (!valid) throw new TypeError("Invalid OAuth handoff signature");
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(decodeBase64Url(encoded))); } catch { throw new TypeError("Invalid OAuth handoff payload"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid OAuth handoff payload");
  return validate(parsed as ExecutorOAuthHandoff, now);
}
