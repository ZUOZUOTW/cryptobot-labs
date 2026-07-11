import { WeexApiError, mapWeexError } from "./errors";

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
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
}

export function createFetchTransport(options: FetchTransportOptions = {}): HttpTransport {
  const fetchImpl = options.fetchImpl ?? fetch;
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
      try {
        response = await fetchImpl(url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        });
      } catch (cause) {
        throw new WeexApiError("WEEX network request failed", {
          category: "network", retryable: true, cause,
        });
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (cause) {
        throw new WeexApiError("WEEX returned malformed JSON", {
          category: "schema", retryable: false, status: response.status, cause,
        });
      }
      if (!response.ok) throw mapWeexError(response.status, body);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
      return { status: response.status, headers, body };
    },
  };
}
