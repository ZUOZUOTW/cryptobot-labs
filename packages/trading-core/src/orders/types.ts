import type { OrderIntent } from "../risk/types";

export type OrderStatus =
  | "proposed"
  | "risk-rejected"
  | "submitting"
  | "acknowledged"
  | "partially-filled"
  | "filled"
  | "cancel-pending"
  | "cancelled"
  | "rejected"
  | "unknown"
  | "reconciled";

export type ApprovedOrderIntent = Readonly<OrderIntent>;

export interface TrackedOrder {
  readonly deploymentId: string;
  readonly clientOrderId: string;
  readonly approvedIntent: ApprovedOrderIntent;
  readonly status: OrderStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly exchangeOrderId?: string;
  readonly cancelAttemptedAt?: number;
  readonly cumulativeFilledQuantity: string;
  readonly averageFillPrice?: string;
  readonly fees?: string;
  readonly reason?: string;
  readonly version: number;
}

export type OrderEvent =
  | { readonly type: "risk-rejected"; readonly reason: string; readonly at: number }
  | { readonly type: "submit-start" | "submit-started"; readonly at: number }
  | { readonly type: "submit-acknowledged"; readonly exchangeOrderId: string; readonly at: number }
  | { readonly type: "submit-rejected"; readonly reason: string; readonly at: number }
  | { readonly type: "submit-timeout"; readonly at: number }
  | {
      readonly type: "fill-snapshot";
      readonly cumulativeFilledQuantity: string;
      readonly averageFillPrice?: string;
      readonly fees?: string;
      readonly at: number;
    }
  | { readonly type: "cancel-request" | "cancel-requested"; readonly at: number }
  | { readonly type: "cancel-acknowledged"; readonly at: number }
  | { readonly type: "cancel-rejected"; readonly reason?: string; readonly at: number }
  | { readonly type: "reconciliation-missing"; readonly at: number };

export interface CreateTrackedOrderInput {
  readonly deploymentId: string;
  readonly clientOrderId: string;
  readonly approvedIntent: ApprovedOrderIntent;
  readonly at: number;
}

export type ExchangeOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED";

export interface ExchangeOrderSnapshot {
  readonly clientOrderId: string;
  readonly exchangeOrderId: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly quantity: string;
  readonly status: ExchangeOrderStatus;
  readonly cumulativeFilledQuantity: string;
  readonly averageFillPrice?: string;
  readonly fees?: string;
}

export interface OrderQuery {
  readonly symbol: string;
  readonly clientOrderId: string;
  readonly exchangeOrderId?: string;
}
