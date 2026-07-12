import { WeexApiError, mapWeexError } from "./errors";

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export const WEEX_PUBLIC_ORIGINS = [
  "https://api-spot.weex.com",
  "https://api-contract.weex.com",
] as const;

export interface FetchTransportOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}

export function createFetchTransport(options: FetchTransportOptions = {}): HttpTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maximumResponseBytes = options.maximumResponseBytes ?? 2_097_152;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000
    || !Number.isSafeInteger(maximumResponseBytes) || maximumResponseBytes < 1_024 || maximumResponseBytes > 10_485_760) {
    throw new TypeError("Invalid public transport resource limits");
  }
  const allowedOrigins = new Set<string>(WEEX_PUBLIC_ORIGINS);

  return {
    async send(request): Promise<HttpResponse> {
      if (!(["GET", "POST", "DELETE"] as readonly unknown[]).includes(request.method)) {
        throw new WeexApiError("Unsupported HTTP method", { category: "validation", retryable: false });
      }

      let url: URL;
      try {
        url = new URL(request.url);
      } catch (cause) {
        throw new WeexApiError("Invalid request URL", { category: "validation", retryable: false, cause });
      }
      if (url.protocol !== "https:" || url.username || url.password || !allowedOrigins.has(url.origin)) {
        throw new WeexApiError("Request URL is outside the allowed WEEX HTTPS origins", {
          category: "validation", retryable: false,
        });
      }

      let response: Response;
      const controller = new AbortController();
      const externalAbort = () => controller.abort(request.signal?.reason);
      if (request.signal?.aborted) externalAbort();
      else request.signal?.addEventListener("abort", externalAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", externalAbort);
      };
      try {
        response = await fetchImpl(url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: "error",
          signal: controller.signal,
        });
      } catch (cause) {
        cleanup();
        throw new WeexApiError("WEEX network request failed", {
          category: "network", retryable: true, cause,
        });
      }

      let body: unknown;
      try {
        const declared = response.headers.get("content-length");
        if (declared !== null && (/^\d+$/.test(declared) === false || Number(declared) > maximumResponseBytes)) {
          throw new Error("WEEX response exceeds the configured limit");
        }
        if (!response.body) throw new Error("WEEX response has no body");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > maximumResponseBytes) {
              await reader.cancel("response too large");
              throw new Error("WEEX response exceeds the configured limit");
            }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (cause) {
        if (!response.ok) throw mapWeexError(response.status, undefined);
        throw new WeexApiError("WEEX returned malformed JSON", {
          category: "schema", retryable: false, status: response.status, cause,
        });
      } finally {
        cleanup();
      }
      if (!response.ok) throw mapWeexError(response.status, body);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
      return { status: response.status, headers, body };
    },
  };
}
