export type WeexApiErrorCategory =
  | "authentication"
  | "permission"
  | "rate-limit"
  | "validation"
  | "not-found"
  | "server"
  | "schema"
  | "network"
  | "clock";

export interface WeexApiErrorOptions {
  category: WeexApiErrorCategory;
  retryable: boolean;
  status?: number;
  code?: string;
  cause?: unknown;
}

export class WeexApiError extends Error {
  readonly category: WeexApiErrorCategory;
  readonly retryable: boolean;
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options: WeexApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "WeexApiError";
    this.category = options.category;
    this.retryable = options.retryable;
    this.status = options.status;
    this.code = options.code;
  }
}

function isErrorBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bodyMessage(body: Record<string, unknown>): string {
  const candidate = body.message ?? body.msg ?? body.error;
  return typeof candidate === "string" && candidate ? candidate : "WEEX API request failed";
}

export function mapWeexError(status: number, body: unknown): WeexApiError {
  if (!isErrorBody(body)) {
    return new WeexApiError("Malformed WEEX beta API error response", {
      category: "schema", retryable: false, status,
    });
  }

  const rawCode = body.code;
  if (typeof rawCode !== "string" && typeof rawCode !== "number") {
    return new WeexApiError("Malformed WEEX beta API error response", {
      category: "schema", retryable: false, status,
    });
  }
  const code = String(rawCode);
  const numericCode = Number(code);
  const message = bodyMessage(body);

  let category: WeexApiErrorCategory;
  let retryable = false;
  if (status === 429 || code === "429" || numericCode === -1003) {
    category = "rate-limit";
    retryable = true;
  } else if (Number.isInteger(numericCode) && numericCode >= -1058 && numericCode <= -1040) {
    category = numericCode >= -1049 ? "authentication" : "permission";
  } else if (status === 401) {
    category = "authentication";
  } else if (status === 403) {
    category = "permission";
  } else if (status === 404) {
    category = "not-found";
  } else if (status >= 500) {
    category = "server";
    retryable = true;
  } else {
    category = "validation";
  }

  return new WeexApiError(message, { category, retryable, status, code });
}
