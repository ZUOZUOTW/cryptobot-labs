import { describe, expect, it } from "vitest";

import { validateTradeAuditEvent } from "../src/main/trade-audit";

const invalidUnmaskedSuffix = ["live", "api", "key", "1234"].join("-");

function envelope(category: string, event: string, payload: object): object {
  return {
    version: 1,
    id: `audit-${category}-1`,
    category,
    event,
    deploymentId: "deploy-1",
    configurationVersion: "config-1",
    correlationId: "correlation-1",
    occurredAt: 1_700_000_000_000,
    mode: "live",
    market: "spot",
    symbol: "BTCUSDT",
    payload,
  };
}

describe("trade audit contract", () => {
  it.each([
    ["signal", "proposed", {
      signalId: "signal-1", scriptHash: "a".repeat(64), action: "buy", reasonCode: "ma-cross",
    }],
    ["risk", "rejected", { signalId: "signal-1", decisionCode: "daily-loss-limit" }],
    ["order", "unknown", {
      clientOrderId: "cbl-order-1", exchangeOrderId: null, statusCode: "timeout-after-submit",
    }],
    ["fill", "filled", {
      clientOrderId: "cbl-order-1", exchangeOrderId: "weex-3", fillId: "fill-8",
      quantity: "0.0100", price: "63123.45",
    }],
    ["api", "request-failed", {
      endpointId: "spot-create-order", httpStatus: 503, errorCode: "service-unavailable",
    }],
    ["key", "rotated", { maskedApiKeySuffix: "****1234" }],
    ["emergency", "cancel-complete", { outcomeCode: "partial", unresolvedCount: 2 }],
  ])("accepts a bounded %s audit event", (category, event, payload) => {
    expect(validateTradeAuditEvent(envelope(category, event, payload))).toMatchObject({
      category,
      event,
      payload,
    });
  });

  it("rejects credential fields and raw exchange responses", () => {
    expect(() => validateTradeAuditEvent(envelope("api", "request-failed", {
      endpointId: "spot-create-order",
      httpStatus: 401,
      errorCode: "unauthorized",
      apiKey: "weex-key-secret",
    }))).toThrow("API audit payload is invalid");

    expect(() => validateTradeAuditEvent({
      ...envelope("key", "rotated", { maskedApiKeySuffix: "****1234" }),
      headers: { authorization: "secret" },
    })).toThrow("Trade audit event is invalid");
  });

  it("rejects unmasked keys, unsafe free text, and invalid market targets", () => {
    expect(() => validateTradeAuditEvent(envelope("key", "configured", {
      maskedApiKeySuffix: invalidUnmaskedSuffix,
    }))).toThrow("Masked API key suffix is invalid");

    expect(() => validateTradeAuditEvent(envelope("api", "request-failed", {
      endpointId: "POST https://api-spot.weex.com/api/v3/order",
      httpStatus: 400,
      errorCode: "bad request with secret details",
    }))).toThrow();

    expect(() => validateTradeAuditEvent({
      ...envelope("signal", "proposed", {
        signalId: "signal-1", scriptHash: "a".repeat(64), action: "buy", reasonCode: "valid",
      }),
      mode: "futures-demo",
      market: "spot",
    })).toThrow("target is invalid");
  });

  it("returns detached frozen records", () => {
    const input = envelope("risk", "accepted", {
      signalId: "signal-1",
      decisionCode: "within-policy",
    });
    const result = validateTradeAuditEvent(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.payload)).toBe(true);
    expect(result).not.toBe(input);
  });
});
