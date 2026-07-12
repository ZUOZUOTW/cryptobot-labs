import { describe, expect, it } from "vitest";
import { assertLiveUnlock, parseEmergencyCommand, type LiveGateContext } from "../lib/server/live-gates";

const context = (overrides: Partial<LiveGateContext> = {}): LiveGateContext => ({
  botName: "Orbit",
  market: "futures",
  connection: {
    status: "verified", hasLocalCredential: true, withdrawalAccessAbsent: true, version: 4,
    verifiedAt: 390_000,
    permissions: { read: true, spotTrade: true, futuresTrade: true, withdrawal: false },
  },
  risk: {
    id: "risk_1", userId: "usr_1", deploymentId: "run_1", allowedSymbolsJson: '["BTCUSDT"]', maxOrderNotional: "100",
    maxPositionNotional: "500", maxTotalExposure: "1000", maxSimultaneousPositions: 2,
    maxDailyLoss: "50", maxLeverage: "3", maxSlippageBps: 30, minSignalCooldownMs: 0,
    maxConsecutiveFailures: 3, operationMode: "approval-required", createdAt: 370_000, updatedAt: 380_000,
  },
  ...overrides,
});

describe("live execution gates", () => {
  it("requires exact typed consent, a safe verified local connection, and every risk limit", () => {
    expect(() => assertLiveUnlock(context(), { typedBotName: "Orbit", riskAcknowledged: true,
      acceptedAt: 399_999 }, 400_000)).not.toThrow();
    expect(() => assertLiveUnlock(context(), { typedBotName: "orbit", riskAcknowledged: true,
      acceptedAt: 399_999 }, 400_000)).toThrow(/name/i);
    expect(() => assertLiveUnlock(context({ connection: { ...context().connection!, withdrawalAccessAbsent: false } }),
      { typedBotName: "Orbit", riskAcknowledged: true, acceptedAt: 399_999 }, 400_000)).toThrow(/withdrawal/i);
    expect(() => assertLiveUnlock(context({ risk: { ...context().risk, maxDailyLoss: "0" } }),
      { typedBotName: "Orbit", riskAcknowledged: true, acceptedAt: 399_999 }, 400_000)).toThrow(/risk/i);
  });

  it("keeps stop, cancel, and close as distinct contracts with an independent close confirmation", () => {
    expect(parseEmergencyCommand({ type: "stop-new-orders", expectedVersion: 2, reason: "manual" }, 400_000))
      .toMatchObject({ type: "stop-new-orders", payload: { reason: "manual" } });
    expect(parseEmergencyCommand({ type: "cancel-open-orders", expectedVersion: 2,
      scope: "deployment", reason: "manual" }, 400_000)).toMatchObject({ type: "cancel-open-orders" });
    expect(() => parseEmergencyCommand({ type: "close-positions", expectedVersion: 2, scope: "all",
      symbol: null, confirmationPhrase: "CLOSE POSITIONS", riskAcknowledged: false, confirmedAt: 399_999 }, 400_000))
      .toThrow(/risk/i);
    expect(parseEmergencyCommand({ type: "close-positions", expectedVersion: 2, scope: "all", symbol: null,
      confirmationPhrase: "CLOSE POSITIONS", riskAcknowledged: true, confirmedAt: 399_999 }, 400_000))
      .toMatchObject({ type: "close-positions", payload: { scope: "all", symbol: null } });
  });
});
