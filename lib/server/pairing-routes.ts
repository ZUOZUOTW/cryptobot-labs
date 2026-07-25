import type { ApiAuthDependencies } from "./auth";
import { requireApiUser } from "./auth";
import { HttpProblem, errorResponse, jsonResponse, readStrictJson } from "./http";
import type { OriginPolicy } from "./origin";
import { requireSameOrigin } from "./origin";
import { PairingError } from "./pairing";
import { publicKeyJwkJson } from "../../db/repositories/shared";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CODE = /^CBL-[A-Za-z0-9_-]{22}$/;
const BOOTSTRAP = /^bst_[A-Za-z0-9_-]{22}$/;
const CHALLENGE = /^chl_[A-Za-z0-9_-]{43}$/;
const CREDENTIAL = /^cred_[A-Za-z0-9_-]{43}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

type IssueService = { issueCode(input: { userId: string; now: number }): Promise<{ code: string; expiresAt: number }> };
type ConsumeService = { consumeCode(input: { code: string; name: string; platform: "macos" | "windows";
  publicKeyJwk: unknown; now: number }): Promise<{ deviceId: string; bootstrapToken: string; challenge: string; expiresAt: number }> };
type CompleteService = { completeActivation(input: { deviceId: string; bootstrapToken: string; challenge: string;
  proof: { signature: string }; now: number }): Promise<{ credential: string; expiresAt: number }> };
type DeviceRevocation = { id: string; userId: string; status: string; revokedAt: number | null };
type DeviceRepository = { revoke(userId: string, deviceId: string, now: number): Promise<DeviceRevocation | null> };

const plainRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new HttpProblem(400, "invalid_request");
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): void => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new HttpProblem(400, "invalid_request");
  }
};

const safeNow = (now: () => number): number => {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("clock returned an invalid time");
  return value;
};

const futureTime = (value: number, now: number): number => {
  if (!Number.isSafeInteger(value) || value <= now) throw new Error("service returned an invalid expiry");
  return value;
};

const failure = (error: unknown, pairingStatus?: 400 | 401 | 409): Response => {
  if (error instanceof PairingError && pairingStatus) {
    return errorResponse(error, { status: pairingStatus, code: "pairing_failed" });
  }
  if (error instanceof HttpProblem) {
    return errorResponse(error, { status: error.status, code: error.code });
  }
  return errorResponse(error, { status: 500, code: "internal" });
};

const parseIssue = (value: unknown): Record<string, never> => {
  const record = plainRecord(value);
  exactKeys(record, []);
  return {};
};

const parseConsume = (value: unknown): { code: string; name: string; platform: "macos" | "windows"; publicKeyJwk: unknown } => {
  const record = plainRecord(value);
  exactKeys(record, ["code", "name", "platform", "publicKeyJwk"]);
  if (typeof record.code !== "string" || record.code.length > 64
    || typeof record.name !== "string" || record.name.length > 100
    || (record.platform !== "macos" && record.platform !== "windows")) {
    throw new HttpProblem(400, "invalid_request");
  }
  let publicKeyJwk: unknown;
  try { publicKeyJwk = JSON.parse(publicKeyJwkJson(record.publicKeyJwk)); }
  catch { throw new HttpProblem(400, "invalid_request"); }
  return { code: record.code, name: record.name, platform: record.platform, publicKeyJwk };
};

const parseComplete = (value: unknown): { deviceId: string; bootstrapToken: string; challenge: string; signature: string } => {
  const record = plainRecord(value);
  exactKeys(record, ["deviceId", "bootstrapToken", "challenge", "signature"]);
  if (typeof record.deviceId !== "string" || !ID.test(record.deviceId)
    || typeof record.bootstrapToken !== "string" || record.bootstrapToken.length > 128
    || typeof record.challenge !== "string" || record.challenge.length > 128
    || typeof record.signature !== "string" || !SIGNATURE.test(record.signature)) {
    throw new HttpProblem(400, "invalid_request");
  }
  return record as { deviceId: string; bootstrapToken: string; challenge: string; signature: string };
};

export function createIssuePairingCodeHandler(dependencies: {
  auth: ApiAuthDependencies; originPolicy: OriginPolicy; pairingService: IssueService; now: () => number;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      requireSameOrigin(request, dependencies.originPolicy);
      const authenticated = await requireApiUser(request, dependencies.auth);
      if (!authenticated.ok) return authenticated.response;
      await readStrictJson(request, { maximumBytes: 64, parse: parseIssue });
      const now = safeNow(dependencies.now);
      const issued = await dependencies.pairingService.issueCode({ userId: authenticated.user.id, now });
      if (!CODE.test(issued.code)) throw new Error("service returned an invalid pairing code");
      return jsonResponse({ code: issued.code, expiresAt: futureTime(issued.expiresAt, now) }, { status: 201 });
    } catch (error) { return failure(error, 409); }
  };
}

export function createConsumePairingCodeHandler(dependencies: { pairingService: ConsumeService; now: () => number }) {
  return async (request: Request): Promise<Response> => {
    try {
      const input = await readStrictJson(request, { maximumBytes: 4_096, parse: parseConsume });
      const now = safeNow(dependencies.now);
      const consumed = await dependencies.pairingService.consumeCode({ ...input, now });
      if (!ID.test(consumed.deviceId) || !BOOTSTRAP.test(consumed.bootstrapToken) || !CHALLENGE.test(consumed.challenge)) {
        throw new Error("service returned invalid bootstrap material");
      }
      return jsonResponse({ deviceId: consumed.deviceId, bootstrapToken: consumed.bootstrapToken,
        challenge: consumed.challenge, expiresAt: futureTime(consumed.expiresAt, now) });
    } catch (error) { return failure(error, 400); }
  };
}

export function createBootstrapCompleteHandler(dependencies: { pairingService: CompleteService; now: () => number }) {
  return async (request: Request): Promise<Response> => {
    try {
      const input = await readStrictJson(request, { maximumBytes: 2_048, parse: parseComplete });
      const now = safeNow(dependencies.now);
      const activated = await dependencies.pairingService.completeActivation({ deviceId: input.deviceId,
        bootstrapToken: input.bootstrapToken, challenge: input.challenge, proof: { signature: input.signature },
        now });
      if (!CREDENTIAL.test(activated.credential)) throw new Error("service returned an invalid device credential");
      return jsonResponse({ deviceId: input.deviceId, credential: activated.credential,
        expiresAt: futureTime(activated.expiresAt, now) });
    } catch (error) { return failure(error, 401); }
  };
}

export interface DeviceRouteContext { params: { id: string } | Promise<{ id: string }> }

const requireNoBody = (request: Request): void => {
  const declared = request.headers.get("content-length");
  if (request.body !== null || request.headers.has("content-type") || (declared !== null && declared !== "0")) {
    throw new HttpProblem(400, "invalid_request");
  }
};

export function createDeleteDeviceHandler(dependencies: {
  auth: ApiAuthDependencies; originPolicy: OriginPolicy; deviceRepository: DeviceRepository; now: () => number;
}) {
  return async (request: Request, context: DeviceRouteContext): Promise<Response> => {
    try {
      requireSameOrigin(request, dependencies.originPolicy);
      const authenticated = await requireApiUser(request, dependencies.auth);
      if (!authenticated.ok) return authenticated.response;
      requireNoBody(request);
      const route = await context.params;
      if (route === null || typeof route !== "object" || Object.keys(route).length !== 1
        || typeof route.id !== "string" || !ID.test(route.id)) throw new HttpProblem(400, "invalid_request");
      const revoked = await dependencies.deviceRepository.revoke(authenticated.user.id, route.id, safeNow(dependencies.now));
      if (!revoked) throw new HttpProblem(404, "not_found");
      return jsonResponse({ device: { id: revoked.id, status: "revoked", revokedAt: revoked.revokedAt } });
    } catch (error) { return failure(error); }
  };
}
