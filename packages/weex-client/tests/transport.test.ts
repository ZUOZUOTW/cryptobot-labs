import { describe, expect, it, vi } from "vitest";

import { WeexApiError } from "../src/errors";
import { createFetchTransport } from "../src/transport";

describe("createFetchTransport", () => {
  it("normalizes response headers and parses JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "X-Trace-Id": "trace-1" },
      }),
    );
    const transport = createFetchTransport({ fetchImpl });

    await expect(
      transport.send({
        method: "GET",
        url: "https://api-spot.weex.com/api/v3/market/klines?symbol=BTCUSDT&interval=1m",
        headers: { Accept: "application/json" },
      }),
    ).resolves.toEqual({
      status: 200,
      headers: expect.objectContaining({ "x-trace-id": "trace-1" }),
      body: { ok: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "error" });
  });

  it.each([
    "http://api-spot.weex.com/api/v3/market/klines",
    "https://evil.example/api/v3/market/klines",
    "https://user:password@api-spot.weex.com/api/v3/market/klines",
  ])("rejects unsafe URL %s before fetch", async (url) => {
    const fetchImpl = vi.fn();
    const transport = createFetchTransport({ fetchImpl });
    await expect(
      transport.send({ method: "GET", url, headers: {} }),
    ).rejects.toMatchObject({ category: "validation", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unsupported methods before fetch", async () => {
    const fetchImpl = vi.fn();
    const transport = createFetchTransport({ fetchImpl });
    await expect(
      transport.send({ method: "PATCH" as "GET", url: "https://api-spot.weex.com/x", headers: {} }),
    ).rejects.toBeInstanceOf(WeexApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cannot authorize an arbitrary production origin through options", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    const transport = createFetchTransport({
      fetchImpl,
      // @ts-expect-error The production origin allowlist is intentionally not configurable.
      allowedOrigins: ["https://evil.example"],
    });
    await expect(transport.send({ method: "GET", url: "https://evil.example/data", headers: {} }))
      .rejects.toMatchObject({ category: "validation" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps network and malformed JSON failures predictably", async () => {
    const network = createFetchTransport({ fetchImpl: vi.fn(async () => { throw new Error("offline"); }) });
    await expect(network.send({ method: "GET", url: "https://api-spot.weex.com/x", headers: {} }))
      .rejects.toMatchObject({ category: "network", retryable: true });

    const malformed = createFetchTransport({
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 200 })),
    });
    await expect(malformed.send({ method: "GET", url: "https://api-spot.weex.com/x", headers: {} }))
      .rejects.toMatchObject({ category: "schema", retryable: false });
  });

  it("enforces a bounded public response before parsing", async () => {
    const transport = createFetchTransport({ maximumResponseBytes: 1_024,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ value: "x".repeat(2_000) }), {
        headers: { "content-length": "2012" },
      })) });
    await expect(transport.send({ method: "GET", url: "https://api-spot.weex.com/x", headers: {} }))
      .rejects.toMatchObject({ category: "schema", retryable: false });
  });

  it("merges an external abort signal and cleans its timeout", async () => {
    vi.useFakeTimers();
    try {
      const external = new AbortController();
      const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }));
      const pending = createFetchTransport({ fetchImpl, timeoutMs: 10_000 }).send({
        method: "GET", url: "https://api-spot.weex.com/x", headers: {}, signal: external.signal,
      });
      external.abort();
      await expect(pending).rejects.toMatchObject({ category: "network" });
      expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each([
    [503, "upstream unavailable", "server", true],
    [429, "", "rate-limit", true],
  ] as const)("preserves HTTP %s semantics for non-JSON bodies", async (status, body, category, retryable) => {
    const transport = createFetchTransport({
      fetchImpl: vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "text/plain" } })),
    });
    await expect(transport.send({ method: "GET", url: "https://api-spot.weex.com/x", headers: {} }))
      .rejects.toMatchObject({ status, category, retryable });
  });
});
