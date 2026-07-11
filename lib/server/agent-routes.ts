import { CommandServiceError } from "./commands";
import { DeviceEventError } from "./device-events";
import { DeviceAuthenticationError, type VerifiedDeviceIdentity } from "./device-signature";
import { HttpProblem, errorResponse, jsonResponse } from "./http";

export const AGENT_CAPABILITIES = Object.freeze([
  "agent.heartbeat", "agent.events", "agent.commands.read", "agent.commands.ack",
] as const);

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_HEARTBEAT_BYTES = 262_144;
const MAX_EVENT_BATCH_BYTES = 1_048_576;
const MAX_ACK_BYTES = 32_768;

type Verifier = (input: { headers: Headers; method: string; url: string | URL; body: Uint8Array;
  capability: (typeof AGENT_CAPABILITIES)[number] }) => Promise<VerifiedDeviceIdentity>;
type EventService = { ingest(identity: { deviceId: string; verified: true }, input: unknown): Promise<Record<string, unknown>> };
type CommandService = {
  poll(identity: { deviceId: string; verified: true }, input: unknown): Promise<{ items: Array<Record<string, unknown>>;
    nextCursor: { createdAt: number; id: string } | null }>;
  ack(identity: { deviceId: string; verified: true }, input: unknown): Promise<{ acknowledgement: Record<string, unknown>;
    idempotent: boolean }>;
};

export interface AgentRouteContext { params: { id: string } | Promise<{ id: string }> }

const plain = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new HttpProblem(400, "invalid_request");
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: readonly string[]): void => {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))) throw new HttpProblem(400, "invalid_request");
};

async function readRawBytes(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const mediaType = request.headers.get("content-type")?.trim() ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(mediaType)) {
    throw new HttpProblem(415, "unsupported_media_type");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new HttpProblem(Number(declared) > maximumBytes ? 413 : 400,
      Number(declared) > maximumBytes ? "payload_too_large" : "invalid_request");
  }
  if (!request.body) throw new HttpProblem(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel("payload too large");
        throw new HttpProblem(413, "payload_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  if (size === 0 || (declared !== null && Number(declared) !== size)) throw new HttpProblem(400, "invalid_json");
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const parseRawJson = (bytes: Uint8Array): unknown => {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpProblem(400, "invalid_json"); }
};

const requireEmptyGet = (request: Request): Uint8Array => {
  const declared = request.headers.get("content-length");
  if (request.method !== "GET" || request.body !== null || request.headers.has("content-type")
    || (declared !== null && declared !== "0") || request.headers.has("transfer-encoding")) {
    throw new HttpProblem(400, "invalid_request");
  }
  return new Uint8Array();
};

const verifiedIdentity = (identity: VerifiedDeviceIdentity): { deviceId: string; verified: true } =>
  ({ deviceId: identity.deviceId, verified: true });

const parsePoll = (url: URL): { limit: number; cursor: { createdAt: number; id: string } | null } => {
  const allowed = new Set(["limit", "cursorCreatedAt", "cursorId"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new HttpProblem(400, "invalid_request");
  }
  const limitText = url.searchParams.get("limit");
  const limit = limitText === null ? 50 : Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (limitText !== null && !/^(?:[1-9]|[1-9]\d|100)$/.test(limitText))) {
    throw new HttpProblem(400, "invalid_request");
  }
  const cursorCreatedAt = url.searchParams.get("cursorCreatedAt");
  const cursorId = url.searchParams.get("cursorId");
  if ((cursorCreatedAt === null) !== (cursorId === null)) throw new HttpProblem(400, "invalid_request");
  if (cursorCreatedAt === null) return { limit, cursor: null };
  if (!/^(?:0|[1-9]\d{0,15})$/.test(cursorCreatedAt!) || !ID.test(cursorId!)) throw new HttpProblem(400, "invalid_request");
  return { limit, cursor: { createdAt: Number(cursorCreatedAt), id: cursorId! } };
};

const publicCommand = (item: Record<string, unknown>) => {
  let payload: unknown;
  try { payload = JSON.parse(String(item.payloadJson)); }
  catch { throw new Error("stored command payload is invalid"); }
  return { id: item.id, deploymentId: item.deploymentId, type: item.type, version: item.version,
    correlationId: item.correlationId, expectedDeploymentVersion: item.expectedDeploymentVersion,
    payload, createdAt: item.createdAt, expiresAt: item.expiresAt };
};

const failure = (error: unknown): Response => {
  if (error instanceof DeviceAuthenticationError) return errorResponse(error, { status: 401, code: "device_authentication_failed" });
  if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
  if (error instanceof DeviceEventError) return errorResponse(error, {
    status: error.category === "deployment-fence" || error.category === "event-conflict" ? 409 : 400,
    code: error.category === "deployment-fence" || error.category === "event-conflict" ? "conflict" : "invalid_request",
  });
  if (error instanceof CommandServiceError) return errorResponse(error, {
    status: error.category === "invalid-command" ? 400 : 409,
    code: error.category === "invalid-command" ? "invalid_request" : "conflict",
  });
  return errorResponse(error, { status: 500, code: "internal" });
};

export function createAgentHandlers(dependencies: { verify: Verifier; eventService: EventService; commandService: CommandService }) {
  const postEvent = (capability: "agent.heartbeat" | "agent.events", maximumBytes: number) => async (request: Request) => {
    try {
      if (request.method !== "POST") throw new HttpProblem(400, "invalid_request");
      const bytes = await readRawBytes(request, maximumBytes);
      const identity = verifiedIdentity(await dependencies.verify({ headers: request.headers, method: request.method,
        url: request.url, body: bytes, capability }));
      const value = parseRawJson(bytes);
      const events: unknown[] = capability === "agent.heartbeat" ? [value] : (() => {
        const batch = plain(value); exact(batch, ["events"]);
        if (!Array.isArray(batch.events) || batch.events.length < 1 || batch.events.length > 50) {
          throw new HttpProblem(400, "invalid_request");
        }
        return batch.events;
      })();
      const accepted: Array<{ id: string; status: "accepted" | "duplicate" }> = [];
      for (const event of events) {
        const candidate = plain(event);
        if ((capability === "agent.heartbeat") !== (candidate.type === "heartbeat")) throw new HttpProblem(400, "invalid_request");
        const result = await dependencies.eventService.ingest(identity, event);
        accepted.push({ id: String(candidate.id), status: result.idempotent === true ? "duplicate" : "accepted" });
      }
      return jsonResponse({ accepted });
    } catch (error) { return failure(error); }
  };

  return {
    heartbeat: postEvent("agent.heartbeat", MAX_HEARTBEAT_BYTES),
    events: async (request: Request): Promise<Response> => {
      try {
        if (request.method !== "POST") throw new HttpProblem(400, "invalid_request");
        const bytes = await readRawBytes(request, MAX_EVENT_BATCH_BYTES);
        const identity = verifiedIdentity(await dependencies.verify({ headers: request.headers, method: request.method,
          url: request.url, body: bytes, capability: "agent.events" }));
        const batch = plain(parseRawJson(bytes)); exact(batch, ["events"]);
        if (!Array.isArray(batch.events) || batch.events.length < 1 || batch.events.length > 50) {
          throw new HttpProblem(400, "invalid_request");
        }
        const results: Array<{ index: number; eventId?: string; status: "accepted" | "duplicate" | "rejected" | "retryable";
          code: "accepted" | "duplicate" | "invalid_event" | "deployment_fence" | "event_conflict" | "internal" }> = [];
        for (const [index, event] of batch.events.entries()) {
          try {
            const candidate = plain(event);
            if (candidate.type === "heartbeat") throw new DeviceEventError("invalid-event", "heartbeat uses its own endpoint");
            const result = await dependencies.eventService.ingest(identity, event);
            const eventId = candidate.id;
            if (typeof eventId !== "string" || !ID.test(eventId)) throw new Error("event service accepted an invalid id");
            const duplicate = result.idempotent === true;
            results.push({ index, eventId, status: duplicate ? "duplicate" : "accepted",
              code: duplicate ? "duplicate" : "accepted" });
          } catch (error) {
            if (error instanceof DeviceEventError) {
              const code = error.category === "deployment-fence" ? "deployment_fence"
                : error.category === "event-conflict" ? "event_conflict" : "invalid_event";
              results.push({ index, status: "rejected", code });
            } else if (error instanceof HttpProblem) {
              results.push({ index, status: "rejected", code: "invalid_event" });
            } else {
              results.push({ index, status: "retryable", code: "internal" });
            }
          }
        }
        const complete = results.every((result) => result.status === "accepted" || result.status === "duplicate");
        return jsonResponse({ results }, { status: complete ? 200 : 207 });
      } catch (error) { return failure(error); }
    },
    commands: async (request: Request): Promise<Response> => {
      try {
        const body = requireEmptyGet(request);
        const identity = verifiedIdentity(await dependencies.verify({ headers: request.headers, method: request.method,
          url: request.url, body, capability: "agent.commands.read" }));
        const input = parsePoll(new URL(request.url));
        const result = await dependencies.commandService.poll(identity, input);
        return jsonResponse({ commands: result.items.map(publicCommand), nextCursor: result.nextCursor });
      } catch (error) { return failure(error); }
    },
    ack: async (request: Request, context: AgentRouteContext): Promise<Response> => {
      try {
        if (request.method !== "POST") throw new HttpProblem(400, "invalid_request");
        const bytes = await readRawBytes(request, MAX_ACK_BYTES);
        const identity = verifiedIdentity(await dependencies.verify({ headers: request.headers, method: request.method,
          url: request.url, body: bytes, capability: "agent.commands.ack" }));
        const params = await context.params;
        if (params === null || typeof params !== "object" || Object.keys(params).length !== 1
          || typeof params.id !== "string" || !ID.test(params.id)) throw new HttpProblem(400, "invalid_request");
        const value = plain(parseRawJson(bytes));
        exact(value, ["id", "deploymentId", "expectedDeploymentVersion", "status", "payload"]);
        const result = await dependencies.commandService.ack(identity, { ...value, commandId: params.id });
        return jsonResponse({ commandId: params.id, status: "acknowledged", idempotent: result.idempotent });
      } catch (error) { return failure(error); }
    },
  };
}
