import { describe, expect, it, vi } from "vitest";

import { WeexApiError } from "../src/errors";
import { createFetchTransport } from "../src/transport";

describe("createFetchTransport", () => {
  it("normalizes response headers and parses JSON", async () => {
    const fetchImpl = vi.fn(async () =>
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
});
