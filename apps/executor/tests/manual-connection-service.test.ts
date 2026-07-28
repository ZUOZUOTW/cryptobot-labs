import { describe, expect, it } from "vitest";
import { WeexApiError } from "@cryptobot-labs/weex-client";

import { manualConnectionFailureLog, manualConnectionFailureReason } from "../src/manual-connection-service";

describe("manual WEEX connection failure projection", () => {
  it.each([
    [new WeexApiError("invalid key", { category: "authentication", retryable: false, code: "40006" }), "invalid_credentials"],
    [new WeexApiError("invalid passphrase", { category: "authentication", retryable: false, code: "40012" }), "invalid_credentials"],
    [new WeexApiError("illegal IP", { category: "permission", retryable: false, code: "40018" }), "ip_not_allowed"],
    [new WeexApiError("illegal IP", { category: "permission", retryable: false, code: "-1056" }), "ip_not_allowed"],
    [new WeexApiError("permission", { category: "permission", retryable: false, code: "40014" }), "permission_denied"],
    [new WeexApiError("clock", { category: "clock", retryable: false, code: "40005" }), "clock_error"],
    [new WeexApiError("rate", { category: "rate-limit", retryable: true, code: "429" }), "rate_limited"],
    [new WeexApiError("network", { category: "network", retryable: true }), "weex_unavailable"],
    [new WeexApiError("schema", { category: "schema", retryable: false }), "invalid_weex_response"],
  ] as const)("projects %s without exposing raw details", (error, expected) => {
    expect(manualConnectionFailureReason(error)).toBe(expected);
  });

  it("uses a generic safe reason for unknown failures", () => {
    expect(manualConnectionFailureReason(new Error("sensitive internal detail"))).toBe("verification_failed");
  });

  it("never emits raw provider or internal error messages into logs", () => {
    const provider = new WeexApiError("apiKey=secret-value", {
      category: "authentication",
      retryable: false,
      code: "40006",
      status: 401,
    });
    const internal = new Error("postgres://runtime:password@example.invalid/database");

    expect(manualConnectionFailureLog(provider)).toEqual({
      reason: "invalid_credentials",
      source: "provider",
      category: "authentication",
      code: "40006",
      status: 401,
    });
    expect(JSON.stringify(manualConnectionFailureLog(provider))).not.toContain("secret-value");
    expect(manualConnectionFailureLog(internal)).toEqual({
      reason: "verification_failed",
      source: "internal",
    });
    expect(JSON.stringify(manualConnectionFailureLog(internal))).not.toContain("password");
  });
});
