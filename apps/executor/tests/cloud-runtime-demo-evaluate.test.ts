import { cloneVisualStrategyBlock } from "@cryptobot-labs/trading-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = 7_200_000;
const weex = vi.hoisted(() => ({
  clockSend: vi.fn(),
  collectHistoricalCandles: vi.fn(),
  getInstrumentRules: vi.fn(),
  verifyAccount: vi.fn(),
  getAccountSnapshot: vi.fn(),
  findOrderByClientOrderId: vi.fn(),
  submitOrder: vi.fn(),
  decryptWeexCredentials: vi.fn(),
}));

vi.mock("@cryptobot-labs/weex-client", () => {
  class MockWeexApiError extends Error {
    readonly category: string;
    readonly retryable: boolean;
    readonly code?: string;
    readonly status?: number;
    constructor(message: string, options: { category: string; retryable: boolean; code?: string; status?: number }) {
      super(message);
      this.category = options.category;
      this.retryable = options.retryable;
      this.code = options.code;
      this.status = options.status;
    }
  }
  return {
    createFetchTransport: vi.fn(() => ({ send: weex.clockSend })),
    decryptWeexCredentials: weex.decryptWeexCredentials,
    parseIntervalMs: (value: string) => value === "1h" ? 3_600_000 : 60_000,
    WeexApiError: MockWeexApiError,
    WeexClock: class {
      recordServerTime(): void {}
      now(): number { return NOW; }
    },
    WeexPrivateClient: class {
      verifyAccount = weex.verifyAccount;
      getAccountSnapshot = weex.getAccountSnapshot;
      findOrderByClientOrderId = weex.findOrderByClientOrderId;
      submitOrder = weex.submitOrder;
    },
    WeexPublicClient: class {
      collectHistoricalCandles = weex.collectHistoricalCandles;
      getInstrumentRules = weex.getInstrumentRules;
    },
  };
});

import { CloudStrategyRuntime } from "../src/cloud-runtime";

afterEach(() => { vi.restoreAllMocks(); });

describe("cloud Futures Demo evaluation", () => {
  it("evaluates and submits with signed Demo evidence whose live-only permissions are unknown", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    weex.clockSend.mockResolvedValue({ status: 200, headers: { date: new Date(NOW).toUTCString() }, body: {} });
    weex.decryptWeexCredentials.mockResolvedValue({ apiKey: "decrypted" });
    weex.collectHistoricalCandles.mockResolvedValue({
      candles: [
        { openTime: 0, closeTime: 3_599_999, open: "100", high: "101", low: "99", close: "100", volume: "10", complete: true },
        { openTime: 3_600_000, closeTime: 7_199_999, open: "100", high: "101", low: "97", close: "98", volume: "10", complete: true },
      ],
    });
    weex.getInstrumentRules.mockResolvedValue({
      market: "futures", symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT",
      tickSize: "0.1", stepSize: "0.001", minimumQuantity: "0.001", maximumLeverage: "100",
    });
    weex.verifyAccount.mockResolvedValue({
      market: "futures", mode: "futures-demo", verifiedAt: NOW,
      readPermission: true, canTrade: "unknown", withdrawalPermission: "unknown",
      positionMode: "unknown", balanceAssetCount: 1,
    });
    weex.getAccountSnapshot.mockResolvedValue({
      target: { market: "futures", mode: "futures-demo" }, observedAt: NOW,
      balances: [{ asset: "SUSDT", total: "5000", available: "5000", frozen: "0", unrealizedPnl: "0" }],
      positions: [],
    });
    weex.findOrderByClientOrderId.mockResolvedValue(null);
    weex.submitOrder.mockResolvedValue({ status: "acknowledged", exchangeOrderId: "demo-order-1" });

    let resolveOutcome!: (value: "released" | "fail") => void;
    const outcome = new Promise<"released" | "fail">((resolve) => { resolveOutcome = resolve; });
    const run = {
      id: "crun_demo_1", userId: "user_1", connectionId: "conn_1", mode: "futures-demo" as const,
      version: 1, configurationHash: "a".repeat(64),
      config: {
        id: "demo-grid", name: "Demo grid", exchange: "WEEX", market: "futures", symbol: "BTCUSDT",
        timeframe: "1h", logicMode: "all", leverage: 2,
        blocks: [cloneVisualStrategyBlock("grid"), cloneVisualStrategyBlock("stop-loss")],
      },
      risk: {
        allowedSymbols: ["BTCUSDT"], maxOrderNotional: "10000", maxPositionNotional: "10000",
        maxTotalExposure: "10000", maxSimultaneousPositions: 1, maxDailyLoss: "1000",
        maxLeverage: "6", maxSlippageBps: 30, minSignalCooldownMs: 0,
        maxConsecutiveFailures: 3, operationMode: "automatic",
      },
      lastCandleAt: null, lastEvaluatedAt: null, consecutiveFailures: 0, positions: [],
    };
    const repository = {
      claimAccountSnapshots: vi.fn().mockResolvedValue([]),
      claimRuns: vi.fn().mockResolvedValue([run]),
      credential: vi.fn().mockResolvedValue({
        envelope: {}, context: {}, credentialVersion: 1, connectionVersion: 1,
      }),
      blockingOrder: vi.fn().mockResolvedValue(null),
      recordAccountSnapshot: vi.fn().mockResolvedValue(undefined),
      realizedPnl: vi.fn().mockResolvedValue("0"),
      dayStartEquity: vi.fn().mockResolvedValue("5000"),
      hasAcknowledgedOrder: vi.fn().mockResolvedValue(false),
      claimOrder: vi.fn(async (input: Record<string, unknown>) => ({
        status: "claimed", exchangeOrderId: null, clientOrderId: input.clientOrderId,
        candleCloseAt: input.candleCloseAt, createdAt: input.now,
        signal: input.signal, intent: input.intent, fresh: true,
      })),
      submitAuthorizedOrder: vi.fn(async (
        _input: unknown,
        operation: (signal: AbortSignal) => Promise<unknown>,
      ) => ({ authorized: true as const, outcome: await operation(new AbortController().signal) })),
      recordOrder: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(async () => { resolveOutcome("released"); }),
      fail: vi.fn(async () => { resolveOutcome("fail"); }),
      renewRunLease: vi.fn().mockResolvedValue(true),
    };
    const runtime = new CloudStrategyRuntime({
      repository: repository as never,
      kms: {} as never,
      brokerId: "WEEX111162",
      liveTradingEnabled: false,
      now: () => NOW,
      tickIntervalMs: 60_000,
    });

    runtime.start();
    try {
      await expect(Promise.race([
        outcome,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Demo evaluation timed out")), 2_000)),
      ])).resolves.toBe("released");
    } finally {
      runtime.stop();
    }

    expect(weex.verifyAccount).toHaveBeenCalledWith({ market: "futures", mode: "futures-demo" });
    expect(repository.credential).toHaveBeenCalledWith("conn_1", "user_1", {
      market: "futures",
      mode: "futures-demo",
    });
    expect(weex.submitOrder).toHaveBeenCalledOnce();
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledOnce();
    expect(repository.complete).not.toHaveBeenCalled();
  });
});
