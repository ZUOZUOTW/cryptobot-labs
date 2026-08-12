import type {
  CancelOutcome,
  ExchangeExecutionPort,
  ExchangeOrderQuery,
  ExchangeOrderSnapshot,
  ExchangeSubmitRequest,
  SubmitOutcome,
} from "@cryptobot-labs/trading-core";

export interface WeexExecutionClient {
  submitOrder(request: ExchangeSubmitRequest, signal?: AbortSignal): Promise<SubmitOutcome>;
  findOrderByClientOrderId(query: ExchangeOrderQuery): Promise<ExchangeOrderSnapshot | null>;
  cancelOrder(query: ExchangeOrderQuery): Promise<CancelOutcome>;
}

/** Thin target-preserving boundary between exchange-neutral core and WEEX V3. */
export class WeexExecutionAdapter implements ExchangeExecutionPort {
  constructor(private readonly client: WeexExecutionClient) {
    if (!client || typeof client.submitOrder !== "function" ||
        typeof client.findOrderByClientOrderId !== "function" || typeof client.cancelOrder !== "function") {
      throw new TypeError("Invalid WEEX execution client");
    }
  }

  submit(request: ExchangeSubmitRequest): Promise<SubmitOutcome> {
    return this.client.submitOrder(request);
  }

  findByClientOrderId(query: ExchangeOrderQuery): Promise<ExchangeOrderSnapshot | null> {
    return this.client.findOrderByClientOrderId(query);
  }

  cancel(query: ExchangeOrderQuery): Promise<CancelOutcome> {
    return this.client.cancelOrder(query);
  }
}
