const AUTHORIZE_URL = "https://www.weex.com/oauth";
const GATEWAY_ORIGIN = "https://gateway.weex.com";
const TOKEN_PATH = "/v1/oauth/token";
const CREATE_API_PATH = "/v1/oauth/resource/create-api";
const encoder = new TextEncoder();

const BASE64URL = /^[A-Za-z0-9_-]+$/;
const OAUTH_VALUE = /^[A-Za-z0-9._~-]+$/;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function random(length: number, implementation: Pick<Crypto, "getRandomValues">): Uint8Array {
  const value = new Uint8Array(length);
  implementation.getRandomValues(value);
  return value;
}

function bounded(value: unknown, label: string, maximum = 4_096): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new WeexOAuthError(`Invalid WEEX OAuth ${label}`, "invalid_response");
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WeexOAuthError("Invalid WEEX OAuth response", "invalid_response");
  }
  return value as Record<string, unknown>;
}

function successData(value: unknown): Record<string, unknown> {
  const envelope = object(value);
  if (envelope.code !== "00000") {
    const code = typeof envelope.code === "string" && /^\d{5}$/.test(envelope.code) ? envelope.code : "unknown";
    throw new WeexOAuthError(`WEEX OAuth request failed (${code})`, code);
  }
  return object(envelope.data);
}

export class WeexOAuthError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "WeexOAuthError";
    this.code = code;
  }
}

/** Secret container deliberately has no enumerable fields or JSON representation. */
export class WeexOAuthClientCredentials {
  readonly #clientId: string;
  readonly #clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.#clientId = bounded(clientId, "client id", 256);
    this.#clientSecret = bounded(clientSecret, "client secret", 512);
    Object.freeze(this);
  }

  use<T>(operation: (value: Readonly<{ clientId: string; clientSecret: string }>) => T): T {
    return operation({ clientId: this.#clientId, clientSecret: this.#clientSecret });
  }
}

export interface WeexOAuthTransaction {
  readonly state: string;
  readonly stateHash: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
}

export async function createWeexOAuthTransaction(
  implementation: Pick<Crypto, "getRandomValues" | "subtle"> = crypto,
): Promise<WeexOAuthTransaction> {
  const state = base64Url(random(32, implementation));
  const codeVerifier = base64Url(random(64, implementation));
  const [stateDigest, challengeDigest] = await Promise.all([
    implementation.subtle.digest("SHA-256", encoder.encode(state)),
    implementation.subtle.digest("SHA-256", encoder.encode(codeVerifier)),
  ]);
  return Object.freeze({
    state,
    stateHash: base64Url(new Uint8Array(stateDigest)),
    codeVerifier,
    codeChallenge: base64Url(new Uint8Array(challengeDigest)),
  });
}

export function buildWeexAuthorizationUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const redirect = new URL(input.redirectUri);
  if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash) {
    throw new WeexOAuthError("WEEX OAuth redirect URI must be an HTTPS URL", "invalid_redirect");
  }
  if (!OAUTH_VALUE.test(input.state) || input.state.length < 43 || input.state.length > 128) {
    throw new WeexOAuthError("Invalid WEEX OAuth state", "invalid_state");
  }
  if (!OAUTH_VALUE.test(input.codeChallenge) || input.codeChallenge.length < 43 || input.codeChallenge.length > 128) {
    throw new WeexOAuthError("Invalid WEEX OAuth code challenge", "invalid_pkce");
  }
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("clientId", bounded(input.clientId, "client id", 256));
  url.searchParams.set("responseType", "code");
  url.searchParams.set("scope", "create:apikey");
  url.searchParams.set("redirectUri", redirect.toString());
  url.searchParams.set("state", input.state);
  url.searchParams.set("codeChallenge", input.codeChallenge);
  url.searchParams.set("codeChallengeMethod", "S256");
  return url.toString();
}

export function buildWeexOAuthSignaturePayload(input: {
  readonly timestamp: string;
  readonly nonce: string;
  readonly method: string;
  readonly requestPath: string;
  readonly queryString?: string;
  readonly body?: string;
}): string {
  if (!/^\d{13}$/.test(input.timestamp)) throw new WeexOAuthError("Invalid OAuth timestamp", "invalid_request");
  if (!OAUTH_VALUE.test(input.nonce) || input.nonce.length < 16 || input.nonce.length > 128) {
    throw new WeexOAuthError("Invalid OAuth nonce", "invalid_request");
  }
  if (!/^\/[A-Za-z0-9/_-]+$/.test(input.requestPath)) throw new WeexOAuthError("Invalid OAuth request path", "invalid_request");
  const query = input.queryString ?? "";
  if (query && !query.startsWith("?")) throw new WeexOAuthError("OAuth query string must start with ?", "invalid_request");
  return `${input.timestamp}${input.nonce}${input.method.toUpperCase()}${input.requestPath}${query}${input.body ?? ""}`;
}

export async function signWeexOAuthRequest(
  clientSecret: string,
  payload: string,
  implementation: Pick<SubtleCrypto, "importKey" | "sign"> = crypto.subtle,
): Promise<string> {
  const key = await implementation.importKey("raw", encoder.encode(bounded(clientSecret, "client secret", 512)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64(new Uint8Array(await implementation.sign("HMAC", key, encoder.encode(payload))));
}

export interface WeexOAuthHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type WeexOAuthTransport = (input: Readonly<{
  url: string;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
}>) => Promise<WeexOAuthHttpResponse>;

export interface WeexOAuthToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly refreshExpiresIn: number;
  readonly scope: "create:apikey";
}

export interface WeexOAuthApiCredentials {
  readonly apiKey: string;
  readonly secret: string;
  readonly passphrase: string;
}

export class WeexOAuthClient {
  readonly #credentials: WeexOAuthClientCredentials;
  readonly #transport: WeexOAuthTransport;
  readonly #now: () => number;
  readonly #crypto: Pick<Crypto, "getRandomValues" | "subtle">;

  constructor(options: {
    readonly credentials: WeexOAuthClientCredentials;
    readonly transport: WeexOAuthTransport;
    readonly now?: () => number;
    readonly crypto?: Pick<Crypto, "getRandomValues" | "subtle">;
  }) {
    this.#credentials = options.credentials;
    this.#transport = options.transport;
    this.#now = options.now ?? Date.now;
    this.#crypto = options.crypto ?? crypto;
  }

  async exchangeAuthorizationCode(input: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }): Promise<WeexOAuthToken> {
    const redirect = new URL(input.redirectUri);
    if (redirect.protocol !== "https:" || redirect.username || redirect.password || redirect.hash) {
      throw new WeexOAuthError("Invalid WEEX OAuth redirect URI", "invalid_redirect");
    }
    const code = bounded(input.code, "authorization code", 2_048);
    if (!OAUTH_VALUE.test(input.codeVerifier) || input.codeVerifier.length < 43 || input.codeVerifier.length > 128) {
      throw new WeexOAuthError("Invalid WEEX OAuth code verifier", "invalid_pkce");
    }
    const body = JSON.stringify({ grantType: "authorization_code", code, redirectUri: redirect.toString(),
      codeVerifier: input.codeVerifier });
    const response = await this.#signedPost(TOKEN_PATH, body);
    const data = successData(response.body);
    const expiresIn = data.expiresIn;
    const refreshExpiresIn = data.refreshExpiresIn;
    if (!Number.isSafeInteger(expiresIn) || (expiresIn as number) < 1 || !Number.isSafeInteger(refreshExpiresIn)
      || (refreshExpiresIn as number) < 1 || data.scope !== "create:apikey" || data.tokenType !== "Bearer") {
      throw new WeexOAuthError("Invalid WEEX OAuth token response", "invalid_response");
    }
    return Object.freeze({ accessToken: bounded(data.accessToken, "access token", 8_192),
      refreshToken: bounded(data.refreshToken, "refresh token", 8_192), expiresIn: expiresIn as number,
      refreshExpiresIn: refreshExpiresIn as number, scope: "create:apikey" });
  }

  async createApiCredentials(accessToken: string): Promise<WeexOAuthApiCredentials> {
    const token = bounded(accessToken, "access token", 8_192);
    const response = await this.#transport({ url: `${GATEWAY_ORIGIN}${CREATE_API_PATH}`, method: "POST",
      headers: Object.freeze({ Authorization: `Bearer ${token}`, Accept: "application/json" }) });
    if (response.status < 200 || response.status > 299) {
      throw new WeexOAuthError(`WEEX OAuth request failed (HTTP ${response.status})`, "http_error");
    }
    const data = successData(response.body);
    return Object.freeze({ apiKey: bounded(data.apiKey, "API key", 512), secret: bounded(data.secret, "secret", 512),
      passphrase: bounded(data.passphrase, "passphrase", 512) });
  }

  async #signedPost(path: string, body: string): Promise<WeexOAuthHttpResponse> {
    const timestamp = String(this.#now());
    if (!/^\d{13}$/.test(timestamp)) throw new WeexOAuthError("Invalid OAuth clock", "invalid_clock");
    const nonce = base64Url(random(24, this.#crypto));
    const payload = buildWeexOAuthSignaturePayload({ timestamp, nonce, method: "POST", requestPath: path, body });
    const headers = await this.#credentials.use(async ({ clientId, clientSecret }) => Object.freeze({
      "Client-Id": clientId,
      Sign: await signWeexOAuthRequest(clientSecret, payload, this.#crypto.subtle),
      Timestamp: timestamp,
      Nonce: nonce,
      "Content-Type": "application/json",
      Accept: "application/json",
    }));
    const response = await this.#transport({ url: `${GATEWAY_ORIGIN}${path}`, method: "POST", headers, body });
    if (response.status < 200 || response.status > 299) {
      throw new WeexOAuthError(`WEEX OAuth request failed (HTTP ${response.status})`, "http_error");
    }
    return response;
  }
}

export function isCanonicalWeexStateHash(value: string): boolean {
  return value.length === 43 && BASE64URL.test(value);
}
