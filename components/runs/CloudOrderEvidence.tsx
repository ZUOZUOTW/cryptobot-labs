"use client";

import { formatExactDecimal, sumExactDecimals } from "./exactDecimal";

export type CloudOrderEvidenceState = "loading" | "ready" | "stale" | "error" | "unauthorized";
type LifecycleStatus = "claimed" | "risk-rejected" | "acknowledged" | "rejected" | "unknown";
type EvidenceLevel = "authoritative" | "uncertain" | "pending" | "control-plane";
type ProviderStatus = "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED";

interface CloudOrderFillEvidence {
  exchangeFillId: string;
  price: string;
  quantity: string;
  fee: string;
  feeCurrency: string;
  realizedPnl: string | null;
  filledAt: number;
}

export interface CloudOrderEvidence {
  runId: string;
  candleCloseAt: number;
  createdAt: number;
  updatedAt: number;
  lifecycleStatus: LifecycleStatus;
  evidenceLevel: EvidenceLevel;
  errorCode: string | null;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  symbol: string;
  side: "buy" | "sell" | null;
  quantity: string | null;
  requestedPrice: string | null;
  providerStatus: ProviderStatus | null;
  cumulativeFilledQuantity: string | null;
  averageFillPrice: string | null;
  fees: string | null;
  fills: CloudOrderFillEvidence[];
  evidenceObservedAt: number | null;
}

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SYMBOL = /^[A-Z0-9_]{3,32}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;

const compareDecimals = (left: string, right: string): -1 | 0 | 1 => {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftInteger! + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightInteger! + rightFraction.padEnd(scale, "0"));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

const validFillState = (status: ProviderStatus, quantity: string, cumulative: string): boolean => {
  const versusZero = compareDecimals(cumulative, "0");
  const versusQuantity = compareDecimals(cumulative, quantity);
  if (compareDecimals(quantity, "0") <= 0 || versusQuantity > 0) return false;
  if (status === "NEW" || status === "REJECTED") return versusZero === 0;
  if (status === "PARTIALLY_FILLED") return versusZero > 0 && versusQuantity < 0;
  if (status === "FILLED") return versusQuantity === 0;
  return status === "CANCELED";
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const timestamp = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const optional = (value: unknown, pattern: RegExp): string | null | undefined =>
  value === null ? null : typeof value === "string" && pattern.test(value) ? value : undefined;

const parseFill = (value: unknown): CloudOrderFillEvidence | null => {
  const fill = record(value);
  if (!fill || typeof fill.exchangeFillId !== "string" || !ID.test(fill.exchangeFillId)
    || typeof fill.price !== "string" || !DECIMAL.test(fill.price)
    || typeof fill.quantity !== "string" || !DECIMAL.test(fill.quantity)
    || typeof fill.fee !== "string" || !DECIMAL.test(fill.fee)
    || typeof fill.feeCurrency !== "string" || !/^[A-Z0-9]{1,16}$/.test(fill.feeCurrency)) return null;
  const filledAt = timestamp(fill.filledAt);
  const realizedPnl = optional(fill.realizedPnl, SIGNED_DECIMAL);
  return filledAt === null || realizedPnl === undefined ? null : {
    exchangeFillId: fill.exchangeFillId, price: fill.price, quantity: fill.quantity,
    fee: fill.fee, feeCurrency: fill.feeCurrency, realizedPnl, filledAt,
  };
};

const parseOrder = (value: unknown): CloudOrderEvidence | null => {
  const order = record(value);
  if (!order || typeof order.runId !== "string" || !RUN_ID.test(order.runId)
    || typeof order.symbol !== "string" || !SYMBOL.test(order.symbol)
    || !["claimed", "risk-rejected", "acknowledged", "rejected", "unknown"].includes(String(order.lifecycleStatus))
    || !["authoritative", "uncertain", "pending", "control-plane"].includes(String(order.evidenceLevel))
    || (order.side !== null && order.side !== "buy" && order.side !== "sell")
    || (order.providerStatus !== null
      && !["NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED"].includes(String(order.providerStatus)))
    || !Array.isArray(order.fills)) return null;
  const candleCloseAt = timestamp(order.candleCloseAt);
  const createdAt = timestamp(order.createdAt);
  const updatedAt = timestamp(order.updatedAt);
  const evidenceObservedAt = order.evidenceObservedAt === null ? null : timestamp(order.evidenceObservedAt);
  const errorCode = optional(order.errorCode, /^[a-z0-9_-]{1,64}$/);
  const clientOrderId = optional(order.clientOrderId, ID);
  const exchangeOrderId = optional(order.exchangeOrderId, ID);
  const quantity = optional(order.quantity, DECIMAL);
  const requestedPrice = optional(order.requestedPrice, DECIMAL);
  const cumulativeFilledQuantity = optional(order.cumulativeFilledQuantity, DECIMAL);
  const averageFillPrice = optional(order.averageFillPrice, DECIMAL);
  const fees = optional(order.fees, DECIMAL);
  const fills = order.fills.map(parseFill);
  if (candleCloseAt === null || createdAt === null || updatedAt === null
    || errorCode === undefined || clientOrderId === undefined || exchangeOrderId === undefined
    || quantity === undefined || requestedPrice === undefined || cumulativeFilledQuantity === undefined
    || averageFillPrice === undefined || fees === undefined || evidenceObservedAt === undefined
    || fills.some((fill) => fill === null)) return null;
  const evidenceLevel = order.evidenceLevel as EvidenceLevel;
  const authoritative = evidenceLevel === "authoritative";
  if ((authoritative && (order.providerStatus === null || evidenceObservedAt === null
      || clientOrderId === null || exchangeOrderId === null || order.side === null
      || quantity === null || cumulativeFilledQuantity === null
      || !validFillState(order.providerStatus as ProviderStatus, quantity, cumulativeFilledQuantity)))
    || (!authoritative && (order.providerStatus !== null || evidenceObservedAt !== null
      || cumulativeFilledQuantity !== null || averageFillPrice !== null || fees !== null || fills.length > 0))) return null;
  return {
    runId: order.runId, candleCloseAt, createdAt, updatedAt,
    lifecycleStatus: order.lifecycleStatus as LifecycleStatus, evidenceLevel,
    errorCode, clientOrderId, exchangeOrderId, symbol: order.symbol,
    side: order.side as "buy" | "sell" | null, quantity, requestedPrice,
    providerStatus: order.providerStatus as ProviderStatus | null,
    cumulativeFilledQuantity, averageFillPrice, fees,
    fills: fills as CloudOrderFillEvidence[], evidenceObservedAt,
  };
};

export const parseCloudOrderEvidencePayload = (value: unknown, runId: string): CloudOrderEvidence[] | null => {
  const payload = record(value);
  if (!payload || !Array.isArray(payload.orders)) return null;
  const orders = payload.orders.map(parseOrder);
  if (orders.some((order) => order === null)
    || orders.some((order) => order?.runId !== runId)) return null;
  return orders as CloudOrderEvidence[];
};

const lifecycleCopy: Record<LifecycleStatus, string> = {
  claimed: "已建立，待授權",
  "risk-rejected": "風控拒絕",
  acknowledged: "已接受，持續對帳",
  rejected: "已拒絕",
  unknown: "待對帳（狀態不確定）",
};
const providerCopy: Record<ProviderStatus, string> = {
  NEW: "交易所掛單中",
  PARTIALLY_FILLED: "交易所部分成交",
  FILLED: "交易所已成交",
  CANCELED: "交易所已取消",
  REJECTED: "交易所已拒絕",
};

export function CloudOrderEvidenceList({
  orders,
  state,
  locale,
  fallbackAsset,
  retry,
}: {
  orders: readonly CloudOrderEvidence[];
  state: CloudOrderEvidenceState;
  locale: string;
  fallbackAsset: string;
  retry: () => void;
}) {
  const time = (value: number | null) => value === null ? "尚無可信證據"
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(value);
  const amount = (value: string | null, asset?: string) => {
    if (value === null) return "尚無可信證據";
    // Order evidence preserves the exchange's full supported 18-decimal
    // precision. Rounding a non-zero fill or fee to 0.00 would misstate the
    // authoritative record even when the underlying payload is correct.
    const formatted = formatExactDecimal(value, locale, { maximumFractionDigits: 18 });
    return formatted === null ? "尚無可信證據" : `${formatted}${asset ? ` ${asset}` : ""}`;
  };
  const failed = state === "stale" || state === "error";
  const hasRetainedEvidence = failed && orders.length > 0;
  const freshness = state === "ready" ? "current" : hasRetainedEvidence ? "stale" : "unavailable";

  return <section className="run-orders" aria-labelledby="cloud-orders-title"
    data-evidence-freshness={freshness} data-evidence-state={state}>
    <div className="run-orders__heading">
      <div><p className="eyebrow">RUN-BOUND ORDER EVIDENCE</p>
        <h2 id="cloud-orders-title">最近委託與成交對帳</h2></div>
      <p>僅顯示綁定此 run_id 的安全投影；未取得交易所快照時，不推定為拒絕或成交。</p>
    </div>
    {state === "loading" && <p className="runs-empty" role="status">正在核對最近委託與成交證據…</p>}
    {state === "unauthorized" && <p className="runs-empty">登入狀態已過期，成交證據未載入。</p>}
    {failed && <div className="run-orders__notice" role="alert">
      <p>{hasRetainedEvidence
        ? "同步失敗；下列保留上次成功讀取的委託證據供參考，不代表目前即時狀態。"
        : state === "stale"
          ? "同步失敗；上次成功讀取時沒有委託證據，目前無法確認是否仍為空。"
          : "暫時無法讀取委託證據；策略與訂單狀態沒有被更動。"}</p>
      <button className="button button--secondary run-orders__retry" onClick={retry} type="button">重新載入委託證據</button></div>}
    {state === "ready" && orders.length === 0 && <p className="runs-empty">此運行尚無委託證據。</p>}
    {(state === "ready" || failed) && orders.length > 0 && <div className="run-orders__list">
      {orders.map((order) => {
        const uncertain = order.lifecycleStatus === "unknown" || order.lifecycleStatus === "claimed";
        const feeAsset = order.fills[0]?.feeCurrency ?? fallbackAsset;
        const realizedValues = order.fills.flatMap(({ realizedPnl }) => realizedPnl === null ? [] : [realizedPnl]);
        const realized = realizedValues.length ? sumExactDecimals(realizedValues) : null;
        const status = order.providerStatus ? providerCopy[order.providerStatus] : lifecycleCopy[order.lifecycleStatus];
        return <article className="run-order-card glass-panel" data-evidence-level={order.evidenceLevel}
          key={order.clientOrderId ?? `${order.runId}-${order.candleCloseAt}`}>
          <header className="run-order-card__header">
            <div><span className="run-order-card__symbol">{order.symbol}</span>
              <strong>{order.side === "buy" ? "買入" : order.side === "sell" ? "賣出" : "方向待證"}</strong></div>
            <span className="run-order-card__status">{status}</span>
          </header>
          {uncertain && <p className="run-order-card__warning" role="status">
            交易所最終狀態尚未證實；此委託不可視為已拒絕、已取消或已成交。
          </p>}
          <dl className="run-order-card__facts">
            <div><dt>委託數量</dt><dd>{amount(order.quantity)}</dd></div>
            <div><dt>委託價格</dt><dd>{amount(order.requestedPrice, fallbackAsset)}</dd></div>
            <div><dt>累計成交</dt><dd>{amount(order.cumulativeFilledQuantity)}</dd></div>
            <div><dt>成交均價</dt><dd>{amount(order.averageFillPrice, fallbackAsset)}</dd></div>
            <div><dt>手續費</dt><dd>{amount(order.fees, feeAsset)}</dd></div>
            <div><dt>已實現損益</dt><dd>{realized === null ? "尚無交易所證據" : amount(realized, feeAsset)}</dd></div>
            <div><dt>逐筆成交</dt><dd>{order.fills.length ? `${order.fills.length} 筆` : "尚無逐筆證據"}</dd></div>
            <div><dt>交易所快照</dt><dd>{time(order.evidenceObservedAt)}</dd></div>
          </dl>
          <footer className="run-order-card__meta">
            <span>策略 K 線：{time(order.candleCloseAt)}</span>
            <span>更新：{time(order.updatedAt)}</span>
            <span>Client ID：<code>{order.clientOrderId ?? "未公開"}</code></span>
            <span>Exchange ID：<code>{order.exchangeOrderId ?? "尚未取得"}</code></span>
            {order.errorCode && <span>對帳碼：<code>{order.errorCode}</code></span>}
          </footer>
        </article>;
      })}
    </div>}
  </section>;
}
