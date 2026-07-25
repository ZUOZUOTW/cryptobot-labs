import {
  generateDeviceKeyPair,
  type DeviceCrypto,
  type DeviceIdentityVault,
  type GeneratedDeviceKeyPair,
} from "./device-identity";

const CODE = /^CBL-[A-Za-z0-9_-]{22}$/;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BOOTSTRAP = /^bst_[A-Za-z0-9_-]{22}$/;
const CHALLENGE = /^chl_[A-Za-z0-9_-]{43}$/;
const CREDENTIAL = /^cred_[A-Za-z0-9_-]{43}$/;
const MAX_RESPONSE_BYTES = 4_096;
const encoder = new TextEncoder();

export interface PairDeviceInput {
  code: string;
  deviceName: string;
  platform: "macos" | "windows";
}

export interface PairedDevice {
  deviceId: string;
  credentialExpiresAt: number;
}

export interface PairingClientDependencies {
  baseUrl: string | URL;
  identityVault: DeviceIdentityVault;
  fetch?: typeof fetch;
  crypto?: DeviceCrypto;
  now?: () => number;
}

interface BootstrapMaterial {
  deviceId: string;
  bootstrapToken: string;
  challenge: string;
  expiresAt: number;
}

interface ActivationMaterial {
  deviceId: string;
  credential: string;
  expiresAt: number;
}

const base64url = (value: Uint8Array): string => Buffer.from(value).toString("base64url");
const hex = (value: Uint8Array): string => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Pairing service returned invalid data");
  return value as Record<string, unknown>;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error("Pairing service returned invalid data");
  }
}

function validFuture(value: unknown, now: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > now;
}

function parseBootstrap(value: unknown, now: number): BootstrapMaterial {
  const record = plainRecord(value);
  exactKeys(record, ["deviceId", "bootstrapToken", "challenge", "expiresAt"]);
  if (typeof record.deviceId !== "string" || !DEVICE_ID.test(record.deviceId)
    || typeof record.bootstrapToken !== "string" || !BOOTSTRAP.test(record.bootstrapToken)
    || typeof record.challenge !== "string" || !CHALLENGE.test(record.challenge)
    || !validFuture(record.expiresAt, now)) throw new Error("Pairing service returned invalid data");
  return record as unknown as BootstrapMaterial;
}

function parseActivation(value: unknown, expectedDeviceId: string, now: number): ActivationMaterial {
  const record = plainRecord(value);
  exactKeys(record, ["deviceId", "credential", "expiresAt"]);
  if (record.deviceId !== expectedDeviceId || typeof record.credential !== "string" || !CREDENTIAL.test(record.credential)
    || !validFuture(record.expiresAt, now)) throw new Error("Pairing service returned invalid data");
  return record as unknown as ActivationMaterial;
}

function safeClock(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("System clock is invalid");
  return value;
}

function endpoint(baseUrl: string | URL, pathname: string): URL {
  const base = new URL(baseUrl);
  const loopback = base.protocol === "http:" && (base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "[::1]");
  if (base.username || base.password || base.hash || (base.protocol !== "https:" && !loopback)) {
    throw new Error("Pairing origin must use HTTPS");
  }
  return new URL(pathname, base.origin);
}

async function strictJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("Pairing request failed");
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new Error("Pairing service returned invalid data");
  const text = await response.text();
  if (encoder.encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error("Pairing service returned invalid data");
  try { return JSON.parse(text); }
  catch { throw new Error("Pairing service returned invalid data"); }
}

async function postJson(fetcher: typeof fetch, url: URL, body: string): Promise<unknown> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  return strictJson(response);
}

async function sha256Hex(value: string, implementation: DeviceCrypto): Promise<string> {
  const digest = await implementation.digest("SHA-256", encoder.encode(value));
  return hex(new Uint8Array(digest));
}

async function bootstrapCanonical(
  material: BootstrapMaterial,
  keys: GeneratedDeviceKeyPair,
  implementation: DeviceCrypto,
): Promise<string> {
  const publicKeyJson = JSON.stringify(keys.publicKeyJwk);
  const keyHash = await sha256Hex(publicKeyJson, implementation);
  const tokenHash = await sha256Hex(material.bootstrapToken, implementation);
  return `CBL-BOOTSTRAP-V1\n${material.deviceId}\n${keyHash}\n${tokenHash}\n${material.challenge}\n${material.expiresAt}`;
}

export function createPairingClient(dependencies: PairingClientDependencies) {
  const fetcher = dependencies.fetch ?? fetch;
  const implementation = dependencies.crypto ?? crypto.subtle as unknown as DeviceCrypto;
  const now = dependencies.now ?? Date.now;
  const consumeUrl = endpoint(dependencies.baseUrl, "/api/agent/pairings/consume");
  const completeUrl = endpoint(dependencies.baseUrl, "/api/agent/bootstrap/complete");
  let pairing = false;

  return {
    async pair(input: PairDeviceInput): Promise<PairedDevice> {
      if (typeof input !== "object" || input === null || Array.isArray(input)
        || Object.getPrototypeOf(input) !== Object.prototype
        || Object.keys(input).sort().join(",") !== "code,deviceName,platform"
        || !CODE.test(input.code)
        || typeof input.deviceName !== "string" || input.deviceName.trim().length < 1
        || input.deviceName.length > 100 || /[\u0000-\u001f\u007f]/.test(input.deviceName)
        || (input.platform !== "macos" && input.platform !== "windows")) throw new Error("Pairing input is invalid");
      if (pairing) throw new Error("Pairing is already in progress");
      pairing = true;
      let keys: GeneratedDeviceKeyPair | undefined;
      try {
        keys = await generateDeviceKeyPair(implementation);
        const bootstrap = parseBootstrap(await postJson(fetcher, consumeUrl, JSON.stringify({
          code: input.code,
          name: input.deviceName.trim(),
          platform: input.platform,
          publicKeyJwk: keys.publicKeyJwk,
        })), safeClock(now));

        if (safeClock(now) >= bootstrap.expiresAt) throw new Error("Pairing bootstrap expired");
        const canonical = await bootstrapCanonical(bootstrap, keys, implementation);
        const signature = base64url(new Uint8Array(await implementation.sign(
          { name: "Ed25519" }, keys.privateKey, encoder.encode(canonical),
        )));
        const activation = parseActivation(await postJson(fetcher, completeUrl, JSON.stringify({
          deviceId: bootstrap.deviceId,
          bootstrapToken: bootstrap.bootstrapToken,
          challenge: bootstrap.challenge,
          signature,
        })), bootstrap.deviceId, safeClock(now));

        await dependencies.identityVault.replace({
          deviceId: activation.deviceId,
          credential: activation.credential,
          credentialExpiresAt: activation.expiresAt,
          publicKeyJwk: keys.publicKeyJwk,
          privateKeyJwk: keys.privateKeyJwk,
        });
        return { deviceId: activation.deviceId, credentialExpiresAt: activation.expiresAt };
      } finally {
        if (keys?.privateKeyJwk.d) keys.privateKeyJwk.d = "";
        pairing = false;
      }
    },
  };
}
