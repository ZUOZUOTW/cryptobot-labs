import { describe, expect, it, vi } from "vitest";

import type { RiskDecision } from "@cryptobot-labs/trading-core";
import type { ClaimedOrder, CloudRun, CloudRuntimeRepository } from "../src/cloud-repository";
import {
  decimalRatio,
  deriveFuturesPositionSnapshot,
  executeCloudOrder,
  ORDER_RECONCILIATION_GRACE_MS,
  retryWeexRead,
  requireSettlementBalance,
} from "../src/cloud-runtime";
import { WeexApiError } from "@cryptobot-labs/weex-client";

describe("cloud strategy settlement balance", () => {
  it("uses WEEX SUSDT for futures demo execution", () => {
    expect(requireSettlementBalance([
      { asset: "SUSDT", total: "5000", available: "5000" },
    ], "futures-demo")).toMatchObject({ asset: "SUSDT", total: "5000" });
  });

  it("classifies an empty demo wallet as an actionable terminal prerequisite", () => {
    expect(() => requireSettlementBalance([
      { asset: "SUSDT", total: "0", available: "0" },
    ], "futures-demo")).toThrow(expect.objectContaining({
      code: "demo_funds_required",
      stage: "account",
      terminal: true,
    }));
  });

  it("does not use a live USDT balance when the demo settlement asset is absent", () => {
    expect(() => requireSettlementBalance([
      { asset: "USDT", total: "5000", available: "5000" },
      { asset: "USDC", total: "100", available: "100" },
    ], "futures-demo")).toThrow(expect.objectContaining({
      code: "demo_funds_required",
    }));
  });
});

describe("cloud strategy position accounting", () => {
  it("derives an exact futures entry price and post-entry extrema", () => {
    const snapshot = deriveFuturesPositionSnapshot({
      asset: "USDT",
      symbol: "BTCUSDT",
      side: "long",
      leverage: "10",
      size: "0.02",
      openValue: "1801.067",
      unrealizedPnl: "-85.569",
      openedAt: 2_000,
      updatedAt: 4_000,
    }, [
      { openTime: 0, closeTime: 1_999, open: "1", high: "100000", low: "1", close: "90000", volume: "1", complete: true },
      { openTime: 2_000, closeTime: 2_999, open: "90050", high: "92000", low: "88000", close: "91000", volume: "1", complete: true },
      { openTime: 3_000, closeTime: 3_999, open: "91000", high: "93000", low: "89000", close: "92000", volume: "1", complete: true },
    ]);

    expect(snapshot).toEqual({
      side: "long",
      entryTime: 2_000,
      entryPrice: "90053.35",
      peakPrice: "93000",
      troughPrice: "88000",
      quantity: "0.02",
      usedMargin: "1801.067",
      layerCount: 1,
    });
  });

  it("performs decimal division without binary floating-point drift", () => {
    expect(decimalRatio("1", "3")).toBe("0.333333333333333333");
    expect(decimalRatio("650", "0.01")).toBe("65000");
  });
});

const run: CloudRun = {
  id: "run_1",
  userId: "usr_1",
  connectionId: "wc_1",
  mode: "live",
  version: 4,
  configurationHash: "a".repeat(64),
  config: {},
  risk: {},
  lastCandleAt: null,
  lastEvaluatedAt: null,
  consecutiveFailures: 0,
  positions: [],
};
const signal = {
  id: "visual-buy",
  action: "buy" as const,
  reason: "entry",
  createdAt: 1_700_000_000_000,
  allocationRate: 0.5,
};
const intent = {
  symbol: "BTCUSDT",
  side: "buy" as const,
  quantity: "0.0001",
  price: "64000",
  expectedSlippageBps: "30",
  reduceOnly: false,
};
const allowed: RiskDecision = {
  allowed: true,
  normalized: {
    notional: "6.4",
    projectedPositionNotional: "6.4",
    projectedTotalExposure: "6.4",
    dailyPnl: "0",
  },
};
const freshClaim: ClaimedOrder = {
  status: "claimed",
  exchangeOrderId: null,
  clientOrderId: "cb_original",
  createdAt: 1_700_000_000_000,
  fresh: true,
};

const execution = (
  claim: ClaimedOrder,
  overrides: {
    now?: number;
    decision?: RiskDecision;
    find?: ReturnType<typeof vi.fn>;
    submit?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  const repository = {
    recordOrder: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  };
  const client = {
    findOrderByClientOrderId: overrides.find ?? vi.fn(async () => null),
    submitOrder: overrides.submit ?? vi.fn(async () => ({
      status: "acknowledged" as const,
      exchangeOrderId: "exchange-1",
    })),
  };
  return {
    repository,
    client,
    promise: executeCloudOrder({
      repository: repository as unknown as CloudRuntimeRepository,
      client: client as unknown as Parameters<typeof executeCloudOrder>[0]["client"],
      run,
      owner: "owner-1",
      candleCloseAt: 1_699_999_999_999,
      signal,
      intent,
      decision: overrides.decision ?? allowed,
      claim,
      target: { market: "futures", mode: "live" },
      symbol: "BTCUSDT",
      now: overrides.now ?? 1_700_000_000_000,
    }),
  };
};

describe("cloud order crash recovery", () => {
  it("persists an ambiguous state before the first exchange submission", async () => {
    const submit = vi.fn(async () => ({ status: "acknowledged" as const, exchangeOrderId: "exchange-1" }));
    const value = execution(freshClaim, { submit });

    await expect(value.promise).resolves.toBe("completed");

    expect(value.repository.recordOrder).toHaveBeenNthCalledWith(1, expect.objectContaining({
      status: "unknown",
      errorCode: "submission_in_progress",
    }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ clientOrderId: "cb_original" }));
    expect(value.repository.recordOrder).toHaveBeenNthCalledWith(2, expect.objectContaining({
      status: "acknowledged",
      exchangeOrderId: "exchange-1",
    }));
    expect(value.repository.complete).toHaveBeenCalledOnce();
  });

  it("reconciles an earlier claim with its stored client id and never resubmits it", async () => {
    const find = vi.fn(async () => null);
    const submit = vi.fn();
    const value = execution({ ...freshClaim, fresh: false }, {
      now: freshClaim.createdAt + ORDER_RECONCILIATION_GRACE_MS,
      find,
      submit,
    });

    await expect(value.promise).resolves.toBe("completed");

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ clientOrderId: "cb_original" }));
    expect(submit).not.toHaveBeenCalled();
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "rejected",
      errorCode: "stale_claim_no_exchange_order",
    }));
  });

  it("defers a recent missing order so WEEX has time to make it queryable", async () => {
    const value = execution({ ...freshClaim, fresh: false }, {
      now: freshClaim.createdAt + ORDER_RECONCILIATION_GRACE_MS - 1,
    });

    await expect(value.promise).resolves.toBe("deferred");
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.recordOrder).not.toHaveBeenCalled();
    expect(value.repository.complete).not.toHaveBeenCalled();
  });

  it("reconciles an acknowledged exchange order without a duplicate submission", async () => {
    const find = vi.fn(async () => ({ exchangeOrderId: "exchange-existing" }));
    const submit = vi.fn();
    const value = execution({ ...freshClaim, fresh: false, status: "unknown" }, { find, submit });

    await expect(value.promise).resolves.toBe("completed");
    expect(submit).not.toHaveBeenCalled();
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "acknowledged",
      exchangeOrderId: "exchange-existing",
    }));
  });

  it("keeps an ambiguous submit running for reconciliation instead of terminally failing the strategy", async () => {
    const submit = vi.fn(async () => ({ status: "unknown" as const, reason: "ambiguous-submit-outcome" }));
    const value = execution(freshClaim, { submit });

    await expect(value.promise).resolves.toBe("deferred");
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.complete).not.toHaveBeenCalled();
    expect(value.repository.recordOrder).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "unknown",
      errorCode: "ambiguous-submit-outcome",
    }));
  });

  it("leaves durable reconciliation evidence when submission throws before an outcome is recorded", async () => {
    const submit = vi.fn(async () => {
      throw new WeexApiError("network", { category: "network", retryable: true });
    });
    const value = execution(freshClaim, { submit });

    await expect(value.promise).rejects.toMatchObject({ category: "network" });
    expect(value.repository.recordOrder).toHaveBeenCalledTimes(1);
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "unknown",
      errorCode: "submission_in_progress",
    }));
    expect(value.repository.complete).not.toHaveBeenCalled();
  });
});

describe("WEEX safe-read retry policy", () => {
  it("retries bounded transient reads with exponential backoff", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new WeexApiError("network", { category: "network", retryable: true }))
      .mockRejectedValueOnce(new WeexApiError("server", { category: "server", retryable: true }))
      .mockResolvedValueOnce("ready");
    const scheduler = vi.fn(async () => undefined);

    await expect(retryWeexRead(operation, scheduler)).resolves.toBe("ready");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(scheduler.mock.calls).toEqual([[100], [200]]);
  });

  it("does not retry validation failures or exceed the configured bound", async () => {
    const validation = vi.fn(async () => {
      throw new WeexApiError("invalid", { category: "validation", retryable: false });
    });
    const scheduler = vi.fn(async () => undefined);
    await expect(retryWeexRead(validation, scheduler)).rejects.toMatchObject({ category: "validation" });
    expect(validation).toHaveBeenCalledOnce();
    expect(scheduler).not.toHaveBeenCalled();

    const network = vi.fn(async () => {
      throw new WeexApiError("network", { category: "network", retryable: true });
    });
    await expect(retryWeexRead(network, scheduler, 2)).rejects.toMatchObject({ category: "network" });
    expect(network).toHaveBeenCalledTimes(2);
  });
});
