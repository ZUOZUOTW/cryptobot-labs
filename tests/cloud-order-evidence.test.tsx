import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudOrderEvidenceList,
  parseCloudOrderEvidencePayload,
} from "../components/runs/CloudOrderEvidence";

const authoritative = {
  runId: "crun_owner_1",
  candleCloseAt: 1_760_000_000_000,
  createdAt: 1_760_000_000_010,
  updatedAt: 1_760_000_000_200,
  lifecycleStatus: "acknowledged",
  evidenceLevel: "authoritative",
  errorCode: "exchange_order_filled",
  clientOrderId: "b-WEEX111162-safe-client-id",
  exchangeOrderId: "exchange-1",
  symbol: "BTCUSDT",
  side: "buy",
  quantity: "0.002",
  requestedPrice: "64000",
  providerStatus: "FILLED",
  cumulativeFilledQuantity: "0.002",
  averageFillPrice: "64001",
  fees: "0.05",
  fills: [
    { exchangeFillId: "fill-1", price: "64001", quantity: "0.001", fee: "0.03",
      feeCurrency: "USDT", realizedPnl: "1.25", filledAt: 1_760_000_000_100 },
    { exchangeFillId: "fill-2", price: "64001", quantity: "0.001", fee: "0.02",
      feeCurrency: "USDT", realizedPnl: "-0.25", filledAt: 1_760_000_000_150 },
  ],
  evidenceObservedAt: 1_760_000_000_200,
};

afterEach(cleanup);

describe("cloud order evidence UI", () => {
  it("shows exact order, fill, fee, and realized-PnL evidence without floating-point reduction", () => {
    const orders = parseCloudOrderEvidencePayload({ orders: [authoritative] }, "crun_owner_1");
    expect(orders).not.toBeNull();

    render(<CloudOrderEvidenceList orders={orders!} state="ready" locale="zh-TW"
      fallbackAsset="USDT" retry={vi.fn()} />);

    const card = screen.getByRole("article");
    expect(within(card).getByText("交易所已成交")).toBeInTheDocument();
    expect(within(card).getAllByText("0.002")).toHaveLength(2);
    expect(within(card).getByText("64,001.00 USDT")).toBeInTheDocument();
    expect(within(card).getByText("0.05 USDT")).toBeInTheDocument();
    expect(within(card).getByText("1.00 USDT")).toBeInTheDocument();
    expect(within(card).getByText("2 筆")).toBeInTheDocument();
    expect(within(card).getByText("b-WEEX111162-safe-client-id")).toBeInTheDocument();
  });

  it("never rounds a non-zero exchange fill or fee to zero", () => {
    const precise = {
      ...authoritative,
      quantity: "0.000000001",
      cumulativeFilledQuantity: "0.000000001",
      fees: "0.000000000000000001",
      fills: [],
    };
    const orders = parseCloudOrderEvidencePayload({ orders: [precise] }, "crun_owner_1");
    expect(orders).not.toBeNull();

    render(<CloudOrderEvidenceList orders={orders!} state="ready" locale="en-US"
      fallbackAsset="USDT" retry={vi.fn()} />);

    const card = screen.getByRole("article");
    expect(within(card).getAllByText("0.000000001")).toHaveLength(2);
    expect(within(card).getByText("0.000000000000000001 USDT")).toBeInTheDocument();
    expect(within(card).queryByText("0.00")).not.toBeInTheDocument();
  });

  it("labels an unknown order as uncertain and never presents it as rejected or filled", () => {
    const unknown = { ...authoritative, lifecycleStatus: "unknown", evidenceLevel: "uncertain",
      exchangeOrderId: null, providerStatus: null, cumulativeFilledQuantity: null,
      averageFillPrice: null, fees: null, fills: [], evidenceObservedAt: null,
      errorCode: "order_reconciliation_required" };
    const orders = parseCloudOrderEvidencePayload({ orders: [unknown] }, "crun_owner_1");

    render(<CloudOrderEvidenceList orders={orders!} state="ready" locale="zh-TW"
      fallbackAsset="USDT" retry={vi.fn()} />);

    expect(screen.getByText("待對帳（狀態不確定）")).toBeInTheDocument();
    expect(screen.getByText("交易所最終狀態尚未證實；此委託不可視為已拒絕、已取消或已成交。"))
      .toBeInTheDocument();
    expect(screen.queryByText("交易所已拒絕")).not.toBeInTheDocument();
    expect(screen.queryByText("交易所已成交")).not.toBeInTheDocument();
  });

  it("fails parsing closed when uncertain lifecycle data includes a fabricated provider snapshot", () => {
    const contradictory = { ...authoritative, lifecycleStatus: "unknown", evidenceLevel: "uncertain" };

    expect(parseCloudOrderEvidencePayload({ orders: [contradictory] }, "crun_owner_1")).toBeNull();
    expect(parseCloudOrderEvidencePayload({ orders: [authoritative] }, "crun_other")).toBeNull();
  });

  it.each([
    ["fill above quantity", { cumulativeFilledQuantity: "999" }],
    ["filled below quantity", { cumulativeFilledQuantity: "0.001" }],
    ["partial at full quantity", { providerStatus: "PARTIALLY_FILLED", cumulativeFilledQuantity: "0.002" }],
    ["new with a fill", { providerStatus: "NEW", cumulativeFilledQuantity: "0.001" }],
    ["rejected with a fill", { providerStatus: "REJECTED", cumulativeFilledQuantity: "0.001" }],
  ])("fails parsing closed on authoritative %s", (_label, override) => {
    expect(parseCloudOrderEvidencePayload({ orders: [{ ...authoritative, ...override }] }, "crun_owner_1"))
      .toBeNull();
  });

  it("provides explicit loading, empty, and recoverable error states", async () => {
    const retry = vi.fn();
    const { rerender } = render(<CloudOrderEvidenceList orders={[]} state="loading" locale="zh-TW"
      fallbackAsset="USDT" retry={retry} />);
    expect(screen.getByRole("status")).toHaveTextContent("正在核對最近委託與成交證據");

    rerender(<CloudOrderEvidenceList orders={[]} state="ready" locale="zh-TW"
      fallbackAsset="USDT" retry={retry} />);
    expect(screen.getByText("此運行尚無委託證據。")).toBeInTheDocument();

    rerender(<CloudOrderEvidenceList orders={[]} state="error" locale="zh-TW"
      fallbackAsset="USDT" retry={retry} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "重新載入委託證據" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("retains the last successful evidence with an explicit stale warning after background failure", () => {
    const orders = parseCloudOrderEvidencePayload({ orders: [authoritative] }, "crun_owner_1");

    render(<CloudOrderEvidenceList orders={orders!} state="stale" locale="zh-TW"
      fallbackAsset="USDT" retry={vi.fn()} />);

    const section = screen.getByRole("region", { name: "最近委託與成交對帳" });
    expect(section).toHaveAttribute("data-evidence-state", "stale");
    expect(section).toHaveAttribute("data-evidence-freshness", "stale");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "同步失敗；下列保留上次成功讀取的委託證據供參考，不代表目前即時狀態。",
    );
    expect(screen.getByText("交易所已成交")).toBeInTheDocument();
    expect(screen.queryByText("此運行尚無委託證據。")).not.toBeInTheDocument();
  });

  it("retains prior evidence after a manual reload failure and remains recoverable", async () => {
    const retry = vi.fn();
    const orders = parseCloudOrderEvidencePayload({ orders: [authoritative] }, "crun_owner_1");

    render(<CloudOrderEvidenceList orders={orders!} state="error" locale="zh-TW"
      fallbackAsset="USDT" retry={retry} />);

    const section = screen.getByRole("region", { name: "最近委託與成交對帳" });
    expect(section).toHaveAttribute("data-evidence-state", "error");
    expect(section).toHaveAttribute("data-evidence-freshness", "stale");
    expect(screen.getByText("交易所已成交")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "重新載入委託證據" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
