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

const OFFICIAL_CODE_CATEGORIES = new Map<number, readonly [WeexApiErrorCategory, boolean]>([
  [-1000, ["server", true]],
  [-1003, ["rate-limit", true]],
  [-1040, ["authentication", false]],
  [-1041, ["authentication", false]],
  [-1042, ["clock", false]],
  [-1043, ["clock", false]],
  [-1044, ["authentication", false]],
  [-1045, ["validation", false]],
  [-1046, ["clock", false]],
  [-1047, ["authentication", false]],
  [-1048, ["authentication", false]],
  [-1049, ["authentication", false]],
  [-1050, ["permission", false]],
  [-1051, ["permission", false]],
  [-1052, ["permission", false]],
  [-1053, ["permission", false]],
  [-1054, ["server", true]],
  [-1055, ["permission", false]],
  [-1056, ["permission", false]],
  [-1057, ["permission", false]],
  [-1058, ["permission", false]],
  [-1115, ["validation", false]],
  [-1116, ["validation", false]],
  [-1117, ["validation", false]],
  [-1121, ["validation", false]],
  [-1128, ["validation", false]],
  [-1135, ["validation", false]],
  [-1140, ["validation", false]],
  [-1141, ["validation", false]],
  [-1142, ["validation", false]],
  [-1150, ["validation", false]],
  [-1160, ["validation", false]],
  [-1170, ["validation", false]],
  [-1171, ["validation", false]],
  [-1180, ["validation", false]],
  [-1190, ["permission", false]],
  [-2007, ["not-found", false]],
  [-2200, ["not-found", false]],
]);

export function mapWeexError(status: number, body: unknown): WeexApiError {
  if (status === 429) {
    return new WeexApiError("WEEX API rate limit exceeded", {
      category: "rate-limit", retryable: true, status,
    });
  }
  if (status >= 500) {
    return new WeexApiError("WEEX server request failed", {
      category: "server", retryable: true, status,
    });
  }
  if (status === 401) {
    return new WeexApiError("WEEX authentication failed", {
      category: "authentication", retryable: false, status,
    });
  }
  if (status === 403) {
    return new WeexApiError("WEEX permission denied", {
      category: "permission", retryable: false, status,
    });
  }
  if (status === 404) {
    return new WeexApiError("WEEX resource not found", {
      category: "not-found", retryable: false, status,
    });
  }
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

  const mapped = OFFICIAL_CODE_CATEGORIES.get(numericCode);
  const [category, retryable] = code === "429"
    ? ["rate-limit", true] as const
    : mapped ?? ["validation", false] as const;

  return new WeexApiError(message, { category, retryable, status, code });
}
