const MAX_COMPONENT_LENGTH = 256;

export interface ClientOrderIdInput {
  readonly deploymentId: string;
  readonly configurationVersion: string;
  readonly signalId: string;
  readonly sequence: number;
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

export async function deriveClientOrderId(input: ClientOrderIdInput): Promise<string> {
  if (typeof input !== "object" || input === null) throw new TypeError("invalid client order id input");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
    throw new TypeError("sequence must be a safe nonnegative integer");
  }
  const canonical = [
    canonicalPart(input.deploymentId),
    canonicalPart(input.configurationVersion),
    canonicalPart(input.signalId),
    canonicalPart(String(input.sequence)),
  ].join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `cb_${base64Url(new Uint8Array(digest)).slice(0, 32)}`;
}
