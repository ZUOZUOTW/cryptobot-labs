const MAX_COMPONENT_LENGTH = 256;
const WEEX_BROKER_ID = /^WEEX\d{6}$/u;
const BROKER_CLIENT_ORDER_SUFFIX_LENGTH = 22;

export interface ClientOrderIdInput {
  readonly deploymentId: string;
  readonly configurationVersion: string;
  readonly signalId: string;
  readonly sequence: number;
  readonly brokerId?: string;
}

function canonicalPart(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_COMPONENT_LENGTH) {
    throw new TypeError("client order id inputs must be nonempty strings of at most 256 characters");
  }
  const bytes = new TextEncoder().encode(value);
  return `${bytes.byteLength}:${value}`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function isWeexBrokerId(value: unknown): value is string {
  return typeof value === "string" && WEEX_BROKER_ID.test(value);
}

export function isWeexBrokerClientOrderId(value: unknown, brokerId: unknown): value is string {
  return isWeexBrokerId(brokerId) &&
    typeof value === "string" &&
    value.length < 36 &&
    value.startsWith(`b-${brokerId}-`) &&
    /^[A-Za-z0-9_-]+$/u.test(value) &&
    value.length === `b-${brokerId}-`.length + BROKER_CLIENT_ORDER_SUFFIX_LENGTH;
}

export async function deriveClientOrderId(input: ClientOrderIdInput): Promise<string> {
  if (typeof input !== "object" || input === null) throw new TypeError("invalid client order id input");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new TypeError("sequence must be a safe nonnegative integer");
  }
  if (input.brokerId !== undefined && !isWeexBrokerId(input.brokerId)) {
    throw new TypeError("brokerId must use the WEEX plus six digits format");
  }
  const canonical = [
    ...(input.brokerId === undefined ? [] : [canonicalPart(input.brokerId)]),
    canonicalPart(input.deploymentId),
    canonicalPart(input.configurationVersion),
    canonicalPart(input.signalId),
    canonicalPart(String(input.sequence)),
  ].join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const encoded = base64Url(new Uint8Array(digest));
  return input.brokerId === undefined
    ? `cb_${encoded.slice(0, 32)}`
    : `b-${input.brokerId}-${encoded.slice(0, BROKER_CLIENT_ORDER_SUFFIX_LENGTH)}`;
}
