import { parseIntervalMs } from "@cryptobot-labs/weex-client";
import type { TrackedOrder } from "@cryptobot-labs/trading-core";

import type { DeploymentBundle } from "./deployment-client";
import { buildPaperEvaluationRequest, type PaperAccountSnapshot } from "./paper-evaluation-context";
import type { DurablePaperAccount } from "./paper-account";
import type { MarketStreamState } from "./market-stream";
import type { PublicMarketService, PublicMarketSnapshot } from "./public-market-service";
import type { PaperRunRunner } from "./paper-run-runner";

export interface PaperSchedulerOptions {
  readonly collector: Pick<PublicMarketService, "collect">;
  readonly market: Pick<MarketStreamState, "requireFresh">;
  readonly account: (deploymentId: string) => Pick<DurablePaperAccount, "initialize" | "mark" | "snapshot" | "applyFill" | "evaluationCursor" | "completeEvaluation">;
  readonly runner: Pick<PaperRunRunner, "resume" | "pause" | "evaluate">;
  readonly onFault: (reason: string, bundle: DeploymentBundle) => void | Promise<void>;
  readonly onHeartbeat?: (account: PaperAccountSnapshot, markPrice: string, leverage: string,
    observedAt: number, bundle: DeploymentBundle, sequence: number) => void | Promise<void>;
  readonly onOrder?: (order: TrackedOrder, bundle: DeploymentBundle) => void | Promise<void>;
  readonly now?: () => number;
  readonly schedule?: (work: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

/** Evaluates at most once per completed candle and persists the cursor after all side effects. */
export class PaperScheduler {
  readonly #options: PaperSchedulerOptions;
  #bundle: DeploymentBundle | null = null;
  #account: ReturnType<PaperSchedulerOptions["account"]> | null = null;
  #active = false;
  #busy = false;
  #timer: unknown = null;
  #heartbeatAt = -1;
  #heartbeatOrdinal = 0;

  constructor(options: PaperSchedulerOptions) { this.#options = options; }

  async resume(bundle: DeploymentBundle): Promise<void> {
    if (this.#bundle || bundle.deployment.mode !== "paper" || bundle.risk === null || bundle.strategy.config === null) {
      throw new Error("Paper scheduler cannot prepare this deployment");
    }
    const account = this.#options.account(bundle.deployment.id);
    await account.initialize({ deploymentId: bundle.deployment.id, market: bundle.strategy.market,
      symbol: bundle.strategy.symbol, initialEquity: bundle.risk.maxTotalExposure, now: (this.#options.now ?? Date.now)() });
    await this.#options.runner.resume(bundle); this.#account = account; this.#bundle = bundle;
  }

  async activate(): Promise<void> {
    if (!this.#bundle || this.#active) throw new Error("Paper scheduler is not prepared");
    this.#active = true;
    try { await this.#tick(); this.#scheduleNext(); }
    catch (error) { await this.#fault("paper-evaluation-failed"); throw error; }
  }

  async pause(): Promise<void> {
    this.#active = false;
    this.#cancelTimer();
    await this.#options.runner.pause(); this.#bundle = null; this.#account = null;
  }

  async #tick(): Promise<void> {
    const bundle = this.#bundle, account = this.#account;
    if (!this.#active || !bundle || !account || this.#busy) return;
    this.#busy = true;
    try {
      const snapshot: PublicMarketSnapshot = await this.#options.collector.collect({ market: bundle.strategy.market,
        symbol: bundle.strategy.symbol, timeframe: (bundle.strategy.config as { timeframe?: unknown }).timeframe as string });
      const latest = snapshot.candles.at(-1); if (!latest) throw new Error("Paper market snapshot has no candle");
      const cursor = await account.evaluationCursor();
      const quote = this.#options.market.requireFresh(bundle.strategy.market, bundle.strategy.symbol, snapshot.collectedAt, 60_000);
      await account.mark(quote.last, snapshot.collectedAt);
      const leverage = String((bundle.strategy.config as { leverage?: unknown }).leverage);
      const accountSnapshot = await account.snapshot(leverage);
      await this.#options.onHeartbeat?.(accountSnapshot, quote.last, leverage, snapshot.collectedAt, bundle,
        this.#heartbeatSequence(snapshot.collectedAt));
      if (cursor.lastEvaluatedCloseTime !== null && latest.closeTime <= cursor.lastEvaluatedCloseTime) return;
      const request = buildPaperEvaluationRequest({ bundle, market: snapshot, quote, account: accountSnapshot,
        signalSequence: cursor.nextSignalSequence });
      const result = await this.#options.runner.evaluate(request);
      const signaled = result.status === "proposed";
      if (result.status === "proposed" && (result.outcome.status === "submitted" || result.outcome.status === "idempotent"
        || result.outcome.status === "risk-rejected")) await this.#options.onOrder?.(result.outcome.order, bundle);
      if (result.status === "proposed" && (result.outcome.status === "submitted" || result.outcome.status === "idempotent") &&
          result.outcome.order.status === "filled") await account.applyFill(result.outcome.order, snapshot.collectedAt);
      await account.completeEvaluation({ closeTime: latest.closeTime, at: snapshot.collectedAt,
        signaled, failed: result.status === "paused" });
    } finally { this.#busy = false; }
  }

  #scheduleNext(): void {
    const bundle = this.#bundle; if (!this.#active || !bundle) return;
    const interval = parseIntervalMs(String((bundle.strategy.config as { timeframe?: unknown }).timeframe));
    const delay = Math.max(5_000, Math.min(60_000, Math.floor(interval / 4)));
    this.#timer = (this.#options.schedule ?? setTimeout)(() => { this.#timer = null;
      void this.#tick().then(() => this.#scheduleNext()).catch(() => this.#fault("paper-evaluation-failed")); }, delay);
  }

  async #fault(reason: string): Promise<void> {
    const bundle = this.#bundle;
    this.#active = false;
    this.#cancelTimer();
    await this.#options.runner.pause().catch(() => undefined);
    if (bundle) await this.#options.onFault(reason, bundle);
  }

  #cancelTimer(): void {
    if (this.#timer === null) return;
    if (this.#options.cancel) this.#options.cancel(this.#timer);
    else clearTimeout(this.#timer as ReturnType<typeof setTimeout>);
    this.#timer = null;
  }

  #heartbeatSequence(observedAt: number): number {
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("Invalid heartbeat time");
    if (observedAt === this.#heartbeatAt) this.#heartbeatOrdinal += 1;
    else { this.#heartbeatAt = observedAt; this.#heartbeatOrdinal = 0; }
    const sequence = observedAt * 1_000 + this.#heartbeatOrdinal;
    if (!Number.isSafeInteger(sequence)) throw new Error("Heartbeat sequence overflow");
    return sequence;
  }
}
