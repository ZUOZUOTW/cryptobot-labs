import { describe, expect, it, vi } from "vitest";

import type { RiskDecision } from "@cryptobot-labs/trading-core";
import type { ClaimedOrder, CloudRun, CloudRuntimeRepository } from "../src/cloud-repository";
import {
  decimalRatio,
  deriveFuturesPositionSnapshot,
  executeCloudOrder,
  ORDER_RECONCILIATION_GRACE_MS,
  retryWeexRead,
  settleBlockingCloudOrder,
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
const exchangeSnapshot = (
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED",
  cumulativeFilledQuantity = status === "FILLED" ? "0.0001" : "0",
) => ({
  clientOrderId: "cb_original",
  exchangeOrderId: "exchange-existing",
  symbol: "BTCUSDT",
  side: "buy" as const,
  quantity: "0.0001",
  status,
  cumulativeFilledQuantity,
});
const freshClaim: ClaimedOrder = {
  status: "claimed",
  exchangeOrderId: null,
  clientOrderId: "cb_original",
  candleCloseAt: 1_699_999_999_999,
  createdAt: 1_700_000_000_000,
  signal,
  intent,
  fresh: true,
};

const execution = (
  claim: ClaimedOrder,
  overrides: {
    now?: number;
    decision?: RiskDecision;
    find?: ReturnType<typeof vi.fn>;
    submit?: ReturnType<typeof vi.fn>;
    authorized?: boolean;
  } = {},
) => {
  const repository = {
    recordOrder: vi.fn(async () => undefined),
    complete: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    submitAuthorizedOrder: vi.fn(async (
      _input: unknown,
      operation: (signal: AbortSignal) => Promise<unknown>,
    ) => overrides.authorized === false
      ? { authorized: false as const }
      : { authorized: true as const, outcome: await operation(new AbortController().signal) }),
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
      credentialVersion: 3,
      connectionVersion: 5,
    }),
  };
};

describe("cloud order crash recovery", () => {
  it("keeps an accepted first submission blocking until an exchange lookup proves it terminal", async () => {
    const submit = vi.fn(async () => ({ status: "acknowledged" as const, exchangeOrderId: "exchange-1" }));
    const value = execution(freshClaim, { submit });

    await expect(value.promise).resolves.toBe("deferred");

    expect(value.repository.submitAuthorizedOrder).toHaveBeenCalledWith(expect.objectContaining({
      run,
      owner: "owner-1",
      candleCloseAt: freshClaim.candleCloseAt,
      credentialVersion: 3,
      connectionVersion: 5,
    }), expect.any(Function));
    expect(value.repository.submitAuthorizedOrder.mock.invocationCallOrder[0])
      .toBeLessThan(submit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ clientOrderId: "cb_original" }),
      expect.any(AbortSignal),
    );
    expect(value.repository.recordOrder).not.toHaveBeenCalled();
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.complete).not.toHaveBeenCalled();
  });

  it("never submits when the final database authorization rejects the connection", async () => {
    const value = execution(freshClaim, { authorized: false });

    await expect(value.promise).resolves.toBe("deferred");

    expect(value.client.submitOrder).not.toHaveBeenCalled();
    expect(value.repository.complete).not.toHaveBeenCalled();
    expect(value.repository.release).not.toHaveBeenCalled();
  });

  it("completes a first submission only when WEEX proves it was rejected", async () => {
    const submit = vi.fn(async () => ({ status: "rejected" as const, reason: "insufficient_margin" }));
    const value = execution(freshClaim, { submit });

    await expect(value.promise).resolves.toBe("completed");
    expect(value.repository.submitAuthorizedOrder).toHaveBeenCalledOnce();
    expect(value.repository.release).not.toHaveBeenCalled();
    expect(value.repository.complete).toHaveBeenCalledOnce();
  });

  it("quarantines an earlier claim with its stored client id and never resubmits or guesses a terminal result", async () => {
    const find = vi.fn(async () => null);
    const submit = vi.fn();
    const value = execution({ ...freshClaim, fresh: false }, {
      now: freshClaim.createdAt + ORDER_RECONCILIATION_GRACE_MS,
      find,
      submit,
    });

    await expect(value.promise).resolves.toBe("deferred");

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ clientOrderId: "cb_original" }));
    expect(submit).not.toHaveBeenCalled();
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "unknown",
      errorCode: "order_reconciliation_required",
    }));
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.complete).not.toHaveBeenCalled();
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
    const find = vi.fn(async () => exchangeSnapshot("FILLED"));
    const submit = vi.fn();
    const value = execution({ ...freshClaim, fresh: false, status: "unknown" }, { find, submit });

    await expect(value.promise).resolves.toBe("completed");
    expect(submit).not.toHaveBeenCalled();
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "acknowledged",
      exchangeOrderId: "exchange-existing",
      exchangeEvidence: expect.objectContaining({
        clientOrderId: "cb_original",
        status: "FILLED",
        cumulativeFilledQuantity: "0.0001",
      }),
      errorCode: "exchange_order_filled",
    }));
    expect(value.repository.release).not.toHaveBeenCalled();
    expect(value.repository.complete).toHaveBeenCalledOnce();
  });

  it.each([
    ["NEW", "0", "exchange_order_open"],
    ["PARTIALLY_FILLED", "0.00005", "exchange_order_partially_filled"],
  ] as const)("keeps a %s limit order blocking newer submissions", async (status, filled, errorCode) => {
    const submit = vi.fn();
    const value = execution({ ...freshClaim, fresh: false, status: "acknowledged" }, {
      find: vi.fn(async () => exchangeSnapshot(status, filled)),
      submit,
    });

    await expect(value.promise).resolves.toBe("deferred");
    expect(submit).not.toHaveBeenCalled();
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "acknowledged",
      errorCode,
    }));
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.complete).not.toHaveBeenCalled();
  });

  it("preserves ownership evidence when a partially filled order is later cancelled", async () => {
    const value = execution({ ...freshClaim, fresh: false, status: "acknowledged" }, {
      find: vi.fn(async () => exchangeSnapshot("CANCELED", "0.00005")),
    });

    await expect(value.promise).resolves.toBe("completed");
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "acknowledged",
      errorCode: "exchange_order_cancelled_partially_filled",
    }));
  });

  it("closes an unfilled cancelled order as rejected", async () => {
    const value = execution({ ...freshClaim, fresh: false, status: "acknowledged" }, {
      find: vi.fn(async () => exchangeSnapshot("CANCELED")),
    });

    await expect(value.promise).resolves.toBe("completed");
    expect(value.repository.recordOrder).toHaveBeenCalledWith(expect.objectContaining({
      status: "rejected",
      errorCode: "exchange_order_cancelled",
    }));
  });

  it("never treats a temporarily missing previously acknowledged order as rejected", async () => {
    const value = execution({ ...freshClaim, fresh: false, status: "acknowledged",
      exchangeOrderId: "exchange-existing" }, {
      now: freshClaim.createdAt + ORDER_RECONCILIATION_GRACE_MS * 100,
      find: vi.fn(async () => null),
    });

    await expect(value.promise).resolves.toBe("deferred");
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.recordOrder).not.toHaveBeenCalled();
    expect(value.repository.complete).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous submit running for reconciliation instead of terminally failing the strategy", async () => {
    const submit = vi.fn(async () => ({ status: "unknown" as const, reason: "ambiguous-submit-outcome" }));
    const value = execution(freshClaim, { submit });

    await expect(value.promise).resolves.toBe("deferred");
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.complete).not.toHaveBeenCalled();
    expect(value.repository.submitAuthorizedOrder).toHaveBeenCalledOnce();
    expect(value.repository.recordOrder).not.toHaveBeenCalled();
  });

  it("leaves durable reconciliation evidence when submission throws before an outcome is recorded", async () => {
    const submit = vi.fn(async () => {
      throw new WeexApiError("network", { category: "network", retryable: true });
    });
    const value = execution(freshClaim, { submit });

    await expect(value.promise).rejects.toMatchObject({ category: "network" });
    expect(value.repository.submitAuthorizedOrder).toHaveBeenCalledOnce();
    expect(value.repository.recordOrder).not.toHaveBeenCalled();
    expect(value.repository.complete).not.toHaveBeenCalled();
  });

  it("keeps an older unresolved candle quarantined so no newer order can be submitted", async () => {
    const submit = vi.fn();
    const repository = {
      recordOrder: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    const olderOrder: ClaimedOrder = {
      ...freshClaim,
      status: "unknown",
      fresh: false,
      intent: null,
      candleCloseAt: 1_699_999_940_000,
      createdAt: 1_699_999_940_001,
    };
    const client = {
      findOrderByClientOrderId: vi.fn(async () => null),
      submitOrder: submit,
    };

    await expect(settleBlockingCloudOrder({
      repository: repository as unknown as CloudRuntimeRepository,
      client,
      run,
      owner: "owner-1",
      order: olderOrder,
      target: { market: "futures", mode: "live" },
      symbol: "BTCUSDT",
      now: olderOrder.createdAt + ORDER_RECONCILIATION_GRACE_MS,
    })).resolves.toBe("deferred");

    expect(submit).not.toHaveBeenCalled();
    expect(repository.recordOrder).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith(
      run.id, "owner-1", olderOrder.createdAt + ORDER_RECONCILIATION_GRACE_MS,
    );
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("never terminally rejects a very old unknown submission without authoritative exchange evidence", async () => {
    const value = execution({ ...freshClaim, fresh: false, status: "unknown" }, {
      now: freshClaim.createdAt + ORDER_RECONCILIATION_GRACE_MS * 10_000,
      find: vi.fn(async () => null),
    });

    await expect(value.promise).resolves.toBe("deferred");
    expect(value.repository.release).toHaveBeenCalledOnce();
    expect(value.repository.recordOrder).not.toHaveBeenCalled();
    expect(value.repository.complete).not.toHaveBeenCalled();
  });

  it("finishes a terminal rejected order row left behind by a crash without querying or submitting", async () => {
    const find = vi.fn();
    const repository = {
      recordOrder: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };

    await expect(settleBlockingCloudOrder({
      repository: repository as unknown as CloudRuntimeRepository,
      client: { findOrderByClientOrderId: find },
      run,
      owner: "owner-1",
      order: { ...freshClaim, status: "risk-rejected", fresh: false },
      target: { market: "futures", mode: "live" },
      symbol: "BTCUSDT",
      now: freshClaim.createdAt + 1,
    })).resolves.toBe("completed");

    expect(find).not.toHaveBeenCalled();
    expect(repository.recordOrder).not.toHaveBeenCalled();
    expect(repository.complete).toHaveBeenCalledOnce();
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
