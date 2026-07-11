import type { ApprovedOrderIntent, ExchangeOrderSnapshot, OrderQuery } from "./types";
import type { ExecutionTarget } from "./execution-target";

export interface ExchangeSubmitRequest {
  readonly target: ExecutionTarget;
  readonly clientOrderId: string;
  readonly intent: ApprovedOrderIntent;
}

export interface ExchangeOrderQuery extends OrderQuery {
  readonly target: ExecutionTarget;
}

export type SubmitOutcome =
  | { readonly status: "acknowledged"; readonly exchangeOrderId: string }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "unknown"; readonly reason?: string };

export type CancelOutcome =
  | { readonly status: "cancelled" }
  | { readonly status: "rejected"; readonly reason: string }
  | { readonly status: "unknown"; readonly reason?: string };

export interface ExchangeExecutionPort {
  submit(request: ExchangeSubmitRequest): Promise<SubmitOutcome>;
  findByClientOrderId(query: ExchangeOrderQuery): Promise<ExchangeOrderSnapshot | null>;
  cancel(query: ExchangeOrderQuery): Promise<CancelOutcome>;
}
