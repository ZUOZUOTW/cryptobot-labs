import { cookies } from "next/headers";
import { canonicalDisplayName } from "../display-name";

export const AUTH_ACCESS_COOKIE = "__Host-cbl_access";
export const AUTH_REFRESH_COOKIE = "__Host-cbl_refresh";
export const AUTH_TRANSACTION_COOKIE = "__Host-cbl_auth_tx";

const AUTH_TRANSACTION_TTL_SECONDS = 10 * 60;
const REFRESH_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_TOKEN_LENGTH = 16_384;

export interface SupabaseAuthEnvironment {
  DEMO_MODE?: string;
  PUBLIC_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  AUTH_COOKIE_SECRET?: string;
}

export interface SupabaseAuthConfig {
  origin: string;
  supabaseUrl: string;
  publishableKey: string;
  cookieSecret: string;
}

export interface PlatformUser {
  id: string;
  email: string;
  displayName: string;
}

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

interface CookieWriter extends CookieReader {
  set(name: string, value: string, options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    path: string;
    maxAge: number;
  }): void;
}

export interface SupabaseSessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface AuthTransaction {
  state: string;
  verifier: string;
  returnTo: string;
  issuedAt: number;
}

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const fromBase64Url = (value: string): ArrayBuffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
};

function canonicalOrigin(value: string | undefined): string {
  if (!value) throw new Error("PUBLIC_ORIGIN is required");
  const parsed = new URL(value);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("PUBLIC_ORIGIN is invalid");
  return parsed.origin;
}

function canonicalSupabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("SUPABASE_URL is required");
  const parsed = new URL(value);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password
    || (parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error("SUPABASE_URL is invalid");
  }
  return parsed.origin;
}

export function getSupabaseAuthConfig(
  environment: SupabaseAuthEnvironment = process.env as unknown as SupabaseAuthEnvironment,
): SupabaseAuthConfig {
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const cookieSecret = environment.AUTH_COOKIE_SECRET ?? "";
  if (publishableKey.length < 20 || /\s/.test(publishableKey)) throw new Error("SUPABASE_PUBLISHABLE_KEY is invalid");
  if (new TextEncoder().encode(cookieSecret).length < 32) throw new Error("AUTH_COOKIE_SECRET must contain at least 32 bytes");
  return {
    origin: canonicalOrigin(environment.PUBLIC_ORIGIN),
    supabaseUrl: canonicalSupabaseUrl(environment.SUPABASE_URL),
    publishableKey,
    cookieSecret,
  };
}

export function productionAuthReady(
  environment: SupabaseAuthEnvironment = process.env as unknown as SupabaseAuthEnvironment,
): boolean {
  if (environment.DEMO_MODE !== "false") return false;
  try { getSupabaseAuthConfig(environment); return true; } catch { return false; }
}

function randomBase64Url(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

export async function createAuthTransaction(returnTo: string, config: SupabaseAuthConfig,
  now = Date.now()): Promise<{ transaction: AuthTransaction; cookieValue: string; challenge: string }> {
  const transaction: AuthTransaction = {
    state: randomBase64Url(),
    verifier: randomBase64Url(),
    returnTo: safeReturnTo(returnTo, "/bots"),
    issuedAt: Math.floor(now / 1000),
  };
  const payload = base64Url(new TextEncoder().encode(JSON.stringify(transaction)));
  const cookieValue = `${payload}.${await hmac(payload, config.cookieSecret)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(transaction.verifier));
  return { transaction, cookieValue, challenge: base64Url(new Uint8Array(digest)) };
}

export async function readAuthTransaction(cookieValue: string | undefined, expectedState: string,
  config: SupabaseAuthConfig, now = Date.now()): Promise<AuthTransaction | null> {
  if (!cookieValue || cookieValue.length > 4_096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cookieValue)) return null;
  const [payload, signature] = cookieValue.split(".") as [string, string];
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(config.cookieSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(signature), new TextEncoder().encode(payload));
  if (!valid) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Partial<AuthTransaction>;
    const current = Math.floor(now / 1000);
    if (parsed.state !== expectedState || typeof parsed.verifier !== "string" || parsed.verifier.length < 43
      || typeof parsed.returnTo !== "string" || safeReturnTo(parsed.returnTo, "") !== parsed.returnTo
      || typeof parsed.issuedAt !== "number" || parsed.issuedAt > current + 30
      || current - parsed.issuedAt > AUTH_TRANSACTION_TTL_SECONDS) return null;
    return parsed as AuthTransaction;
  } catch { return null; }
}

export function safeReturnTo(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, "https://app.invalid");
    if (parsed.origin !== "https://app.invalid" || parsed.pathname.startsWith("/auth/")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return fallback; }
}

export function callbackUrl(config: SupabaseAuthConfig, state: string): string {
  return `${config.origin}/auth/callback?state=${encodeURIComponent(state)}`;
}

export function setTransactionCookie(store: CookieWriter, value: string): void {
  store.set(AUTH_TRANSACTION_COOKIE, value, cookieOptions(AUTH_TRANSACTION_TTL_SECONDS));
}

export function clearTransactionCookie(store: CookieWriter): void {
  store.set(AUTH_TRANSACTION_COOKIE, "", cookieOptions(0));
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge };
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= MAX_TOKEN_LENGTH && !/\s/.test(value);
}

function validRefreshToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN_LENGTH && !/\s/.test(value);
}

function parseTokens(value: unknown): SupabaseSessionTokens | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const expiresIn = typeof body.expires_in === "number" ? Math.floor(body.expires_in) : 0;
  if (!validToken(body.access_token) || !validRefreshToken(body.refresh_token) || expiresIn < 60 || expiresIn > 86_400) return null;
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn };
}

export function setSessionCookies(store: CookieWriter, session: SupabaseSessionTokens): void {
  store.set(AUTH_ACCESS_COOKIE, session.accessToken, cookieOptions(session.expiresIn));
  store.set(AUTH_REFRESH_COOKIE, session.refreshToken, cookieOptions(REFRESH_COOKIE_TTL_SECONDS));
}

export function clearSessionCookies(store: CookieWriter): void {
  store.set(AUTH_ACCESS_COOKIE, "", cookieOptions(0));
  store.set(AUTH_REFRESH_COOKIE, "", cookieOptions(0));
}

const authHeaders = (config: SupabaseAuthConfig): Record<string, string> => ({
  apikey: config.publishableKey,
  "content-type": "application/json",
});

export async function exchangeAuthCode(code: string, verifier: string, config: SupabaseAuthConfig,
  fetchImpl: typeof fetch = fetch): Promise<SupabaseSessionTokens | null> {
  if (!validToken(code) || verifier.length < 43 || verifier.length > 128) return null;
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
    method: "POST", headers: authHeaders(config), cache: "no-store", signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const candidate = body && typeof body === "object"
      ? ((body as Record<string, unknown>).error_code ?? (body as Record<string, unknown>).code) : undefined;
    const safeCode = typeof candidate === "string" && /^[a-z0-9_-]{1,80}$/i.test(candidate) ? candidate : "unknown";
    console.error(`[supabase-auth] code exchange rejected status=${response.status} code=${safeCode}`);
    return null;
  }
  const session = parseTokens(body);
  if (!session) {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const expiresIn = typeof record.expires_in === "number" ? Math.floor(record.expires_in) : 0;
    console.error("[supabase-auth] code exchange returned an invalid token response", {
      accessTokenValid: validToken(record.access_token),
      refreshTokenValid: validRefreshToken(record.refresh_token),
      expiresInValid: expiresIn >= 60 && expiresIn <= 86_400,
    });
  }
  return session;
}

export async function refreshSupabaseSession(refreshToken: string, config: SupabaseAuthConfig,
  fetchImpl: typeof fetch = fetch): Promise<SupabaseSessionTokens | null> {
  if (!validRefreshToken(refreshToken)) return null;
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST", headers: authHeaders(config), cache: "no-store", signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return null;
  return parseTokens(await response.json());
}

function parseUser(value: unknown): PlatformUser | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const metadata = body.user_metadata && typeof body.user_metadata === "object"
    ? body.user_metadata as Record<string, unknown> : {};
  const id = typeof body.id === "string" ? body.id : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = [metadata.full_name, metadata.name, metadata.user_name, email.split("@")[0], "會員"]
    .map(canonicalDisplayName)
    .find((candidate): candidate is string => candidate !== null);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !displayName) return null;
  return { id, email, displayName };
}

export async function getUserForAccessToken(accessToken: string, config: SupabaseAuthConfig,
  fetchImpl: typeof fetch = fetch): Promise<PlatformUser | null> {
  if (!validToken(accessToken)) return null;
  const response = await fetchImpl(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.publishableKey, authorization: `Bearer ${accessToken}` },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  return parseUser(await response.json());
}

export async function getCurrentSupabaseUser(
  environment: SupabaseAuthEnvironment = process.env as unknown as SupabaseAuthEnvironment,
  fetchImpl: typeof fetch = fetch, store?: CookieReader): Promise<PlatformUser | null> {
  let config: SupabaseAuthConfig;
  try { config = getSupabaseAuthConfig(environment); } catch { return null; }
  const cookieStore = store ?? await cookies();
  const accessToken = cookieStore.get(AUTH_ACCESS_COOKIE)?.value;
  return accessToken ? getUserForAccessToken(accessToken, config, fetchImpl) : null;
}

export async function revokeSupabaseSession(accessToken: string | undefined, config: SupabaseAuthConfig,
  fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!accessToken || !validToken(accessToken)) return;
  await fetchImpl(`${config.supabaseUrl}/auth/v1/logout`, {
    method: "POST", headers: { apikey: config.publishableKey, authorization: `Bearer ${accessToken}` },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
