import { describe, expect, it } from "vitest";

import type { LiveUnlockInput, RiskPolicy } from "../src";
import { evaluateLiveUnlock } from "../src";
import { riskFixtures } from "./fixtures/risk";

const input: LiveUnlockInput = {
  targetMarket: "spot",
  credentialVerified: true,
  permissions: { read: true, spot: true, futures: false, unknownExtraScope: false },
  withdrawalPermission: "absent",
  policy: riskFixtures.policy,
  typedBotName: "Orbit",
  expectedBotName: "Orbit",
  acceptedRisk: true,
};

describe("evaluateLiveUnlock", () => {
  it("unlocks only when every local requirement is satisfied", () => {
    expect(evaluateLiveUnlock(input)).toEqual({ allowed: true });
    expect(
      evaluateLiveUnlock({
        ...input,
        targetMarket: "futures",
        permissions: { ...input.permissions, spot: false, futures: true },
      }),
    ).toEqual({ allowed: true });
  });

  it.each([
    [{ credentialVerified: false }, "credential-not-verified"],
    [{ permissions: { ...input.permissions, read: false } }, "missing-read-permission"],
    [{ permissions: { ...input.permissions, spot: false } }, "missing-spot-permission"],
    [{ targetMarket: "futures", permissions: { ...input.permissions, spot: false } }, "missing-futures-permission"],
    [{ permissions: { ...input.permissions, unknownExtraScope: true } }, "unknown-extra-scope"],
    [{ withdrawalPermission: "present" }, "withdrawal-permission-present"],
    [{ withdrawalPermission: "unknown" }, "withdrawal-permission-unknown"],
    [{ typedBotName: "" }, "missing-bot-name"],
    [{ typedBotName: " Orbit" }, "bot-name-mismatch"],
    [{ acceptedRisk: false }, "risk-not-accepted"],
  ] as const)("fails closed for %s", (overrides, expected) => {
    expect(evaluateLiveUnlock({ ...input, ...overrides })).toEqual({ allowed: false, reason: expected });
  });

  it("reports a missing mandatory limit before live trading", () => {
    const incomplete = { ...riskFixtures.policy, maximumOrderNotional: null } as unknown as RiskPolicy;
    expect(evaluateLiveUnlock({ ...input, policy: incomplete })).toEqual({
      allowed: false,
      reason: "missing-maximum-order-notional",
    });
  });

  it("fails closed when the entire policy is missing at runtime", () => {
    expect(
      evaluateLiveUnlock({ ...input, policy: undefined as unknown as RiskPolicy }),
    ).toEqual({ allowed: false, reason: "missing-allowed-symbols" });
  });

  it("rejects every missing policy field deterministically", () => {
    const fields = [
      "allowedSymbols",
      "maximumOrderNotional",
      "maximumPositionNotional",
      "maximumTotalExposure",
      "maximumSimultaneousPositions",
      "maximumDailyLoss",
      "maximumLeverage",
      "maximumSlippageBps",
      "minimumSignalCooldownMs",
      "maximumConsecutiveFailures",
      "maximumPriceAgeMs",
    ] as const;
    for (const field of fields) {
      const policy = { ...riskFixtures.policy } as Record<string, unknown>;
      delete policy[field];
      expect(evaluateLiveUnlock({ ...input, policy: policy as unknown as RiskPolicy })).toEqual({
        allowed: false,
        reason: `missing-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
      });
    }
  });

  it("rejects an invalid complete policy", () => {
    expect(
      evaluateLiveUnlock({
        ...input,
        policy: { ...input.policy, maximumLeverage: "unlimited" },
      }),
    ).toEqual({ allowed: false, reason: "invalid-risk-policy" });
  });
});
