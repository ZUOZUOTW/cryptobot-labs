const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class HttpProblem extends Error {
  constructor(readonly status: number, readonly code: string, message = code) {
    super(message);
    this.name = "HttpProblem";
  }
}

const PUBLIC_MESSAGES: Readonly<Record<string, string>> = {
  unauthorized: "Authentication is required.",
  identity_invalid: "The authenticated identity is invalid.",
  identity_conflict: "The authenticated identity could not be linked.",
  forbidden_origin: "The request origin is not allowed.",
  unsupported_media_type: "Content-Type must be application/json.",
  payload_too_large: "The request body is too large.",
  invalid_json: "The JSON request body is invalid.",
  invalid_request: "The request is invalid.",
  pairing_failed: "The pairing request is invalid, expired, or already used.",
  device_authentication_failed: "Device authentication failed.",
  conflict: "The request conflicts with the current resource version or state.",
  not_found: "The requested resource was not found.",
  invalid_strategy_configuration: "The selected strategy configuration is invalid.",
  strategy_request_mismatch: "The backtest request does not match the selected strategy version.",
  invalid_economic_parameters: "The requested capital, fees, slippage, or leverage are outside safe backtest limits.",
  historical_funding_requires_futures: "Historical funding is available only for futures backtests.",
  invalid_historical_range: "The requested historical range is invalid or exceeds server limits.",
  invalid_historical_interval: "The requested historical interval is unsupported.",
  historical_dataset_incomplete: "WEEX historical candles do not satisfy the requested coverage policy.",
  historical_funding_incomplete: "WEEX historical funding coverage is incomplete.",
  data_fetch_failed: "WEEX public historical data could not be collected.",
  backtest_execution_failed: "The historical backtest could not be completed.",
  strategy_integrity_failed: "The selected immutable strategy version failed its integrity check.",
  internal: "An internal error occurred.",
};

export function jsonResponse(value: unknown, init: { status?: number; headers?: HeadersInit } = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
}

export function requestId(value: string): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) throw new HttpProblem(400, "invalid_request", "request id is invalid");
  return value;
}

export function correlationId(value: string): string {
  if (typeof value !== "string" || !REQUEST_ID.test(value)) throw new HttpProblem(400, "invalid_request", "correlation id is invalid");
  return value;
}

export function errorResponse(_cause: unknown, input: { status: number; code: string; requestId?: string }): Response {
  const identifier = input.requestId === undefined ? undefined : requestId(input.requestId);
  const publicCode = Object.hasOwn(PUBLIC_MESSAGES, input.code) ? input.code : "internal";
  const body = JSON.stringify({
    error: { code: publicCode, message: PUBLIC_MESSAGES[publicCode] },
    ...(identifier ? { requestId: identifier } : {}),
  });
  return new Response(body, {
    status: Number.isSafeInteger(input.status) && input.status >= 400 && input.status <= 599 ? input.status : 500,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...(identifier ? { "x-request-id": identifier } : {}),
    },
  });
}

export async function readStrictJson<T>(request: Request, options: {
  maximumBytes: number;
  parse: (value: unknown) => T;
}): Promise<T> {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1 || options.maximumBytes > 10_485_760) {
    throw new TypeError("maximumBytes is invalid");
  }
  const contentType = request.headers.get("content-type")?.trim() ?? "";
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new HttpProblem(415, "unsupported_media_type");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new HttpProblem(400, "invalid_request", "content-length is invalid");
    if (Number(declaredLength) > options.maximumBytes) throw new HttpProblem(413, "payload_too_large");
  }
  if (!request.body) throw new HttpProblem(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > options.maximumBytes) {
        await reader.cancel("payload too large");
        throw new HttpProblem(413, "payload_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new HttpProblem(400, "invalid_json");
  }
  try {
    return options.parse(value);
  } catch (error) {
    if (error instanceof HttpProblem) throw error;
    throw new HttpProblem(400, "invalid_request");
  }
}
