import type { ApprovedOrderIntent, ExchangeOrderSnapshot, OrderQuery } from "./types";

export type SubmitOutcome =
  | { readonly status: "acknowledged"; readonly exchangeOrderId: string }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "unknown"; readonly reason?: string };

export type CancelOutcome =
  | { readonly status: "cancelled" }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "unknown"; readonly reason?: string };

export interface ExchangeExecutionPort {
  submit(intent: ApprovedOrderIntent): Promise<SubmitOutcome>;
  findByClientOrderId(query: OrderQuery): Promise<ExchangeOrderSnapshot | null>;
  cancel(query: OrderQuery): Promise<CancelOutcome>;
}
