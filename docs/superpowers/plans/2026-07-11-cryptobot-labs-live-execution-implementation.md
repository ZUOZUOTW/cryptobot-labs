# CryptoBot Labs Live Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend CryptoBot Labs with evidence-labelled WEEX historical backtesting and a paired Windows/macOS execution agent that keeps API secrets local while supporting paper, WEEX futures demo, and explicitly unlocked live spot/futures automated orders.

**Architecture:** Keep the existing vinext website as the public discovery and authenticated control plane. Add exchange-neutral trading-core and WEEX adapter workspaces, D1-backed user/device/run records, and an Electron agent that stores secrets with OS-backed safeStorage and executes every order through a fail-closed local risk engine. The synthetic preview remains separate from historical, paper/demo, and live evidence.

**Tech Stack:** TypeScript 5, pnpm workspaces, vinext/React, Cloudflare Worker and D1, Drizzle ORM, Vitest, Testing Library, Zod, Decimal.js, fast-check, Web Crypto Ed25519/HMAC-SHA256, Electron, Electron Forge, Electron safeStorage, QuickJS WebAssembly, GitHub Actions.

---

## Source of truth and invariants

- Design specification: `docs/superpowers/specs/2026-07-11-cryptobot-labs-live-execution-design.md`.
- Existing `lib/backtest.ts` remains the synthetic `快速模擬` API. Historical backtesting is a new API.
- `packages/trading-core` is exchange-neutral. `packages/weex-client` depends on it; the reverse dependency is forbidden.
- SecretKey and Passphrase never enter website requests, D1, browser storage, strategy downloads, telemetry, logs, crash reports, or test snapshots.
- Money and quantity calculations use Decimal.js and decimal strings, never JavaScript floating-point arithmetic.
- A timed-out order submission becomes `unknown` and is reconciled by client order ID. It is never automatically resubmitted.
- Every deployment begins in paper mode. Live mode requires all mandatory risk limits and typed confirmation.
- Custom JavaScript runs only in the agent QuickJS sandbox and can output proposed signals only.
- User-visible copy recommends WEEX API without using `WEEX ONLY` or implying other exchanges are implemented.
- Automated tests must use injected transports; they must not reach production WEEX endpoints.

## Dependency order

1. Workspace and shared contracts.
2. WEEX signing, transport, public market data.
3. Historical backtest, risk, order state machine, reconciliation.
4. D1 schema, browser identity, pairing, device protocol.
5. Historical-backtest and control-plane routes/UI.
6. Electron shell, credential vault, pairing, strategy runtime.
7. Paper/demo/live execution and telemetry.
8. Cross-platform installers, CI, full verification, PR and deployment.

---

### Task 1: Create the pnpm workspace and exchange-neutral contracts

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `packages/trading-core/package.json`
- Create: `packages/trading-core/tsconfig.json`
- Create: `packages/trading-core/src/contracts.ts`
- Create: `packages/trading-core/src/schemas.ts`
- Create: `packages/trading-core/src/index.ts`
- Create: `packages/trading-core/tests/contracts.test.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from "vitest";
import { CandleSchema, StrategySignalSchema } from "../src/schemas";

describe("shared trading contracts", () => {
  it("rejects invalid OHLC and credential-shaped signal fields", () => {
    expect(() => CandleSchema.parse({
      openTime: 1,
      closeTime: 2,
      open: "10",
      high: "9",
      low: "8",
      close: "9",
      volume: "1",
      complete: true,
    })).toThrow();
    expect(() => StrategySignalSchema.parse({
      id: "sig-1",
      action: "buy",
      reason: "entry",
      createdAt: 2,
      secretKey: "must-not-pass",
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run packages/trading-core/tests/contracts.test.ts`

Expected: FAIL because `packages/trading-core/src/schemas.ts` does not exist.

- [ ] **Step 3: Add workspace metadata and minimal contracts**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`packages/trading-core/src/contracts.ts`:

```ts
export type Market = "spot" | "futures";
export type ExecutionMode = "paper" | "futures-demo" | "live";
export type SignalAction = "buy" | "sell" | "close" | "hold";

export interface Candle {
  openTime: number;
  closeTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  complete: boolean;
}

export interface StrategySignal {
  id: string;
  action: SignalAction;
  reason: string;
  createdAt: number;
}

export interface StrategyInput {
  candles: readonly Candle[];
  market: Market;
  symbol: string;
  now: number;
}

export interface StrategyEvaluator {
  evaluate(input: Readonly<StrategyInput>): Promise<StrategySignal>;
}
```

Implement strict Zod schemas in `schemas.ts`. Validate finite timestamps, positive decimal strings, high greater than or equal to every price, low less than or equal to every price, closeTime after openTime, known actions, and strict objects so credential-like extra fields fail.

- [ ] **Step 4: Run GREEN and the existing suite**

Run:

```bash
pnpm vitest run packages/trading-core/tests/contracts.test.ts
pnpm test
```

Expected: new contract test PASS; existing 252 tests remain PASS.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml vitest.config.ts packages/trading-core
git commit -m "feat(core): add exchange-neutral trading contracts"
```

---

### Task 2: Implement canonical WEEX signing and secret redaction

**Files:**
- Create: `packages/weex-client/package.json`
- Create: `packages/weex-client/tsconfig.json`
- Create: `packages/weex-client/src/signing.ts`
- Create: `packages/weex-client/src/redaction.ts`
- Create: `packages/weex-client/src/index.ts`
- Create: `packages/weex-client/tests/signing.test.ts`
- Create: `packages/weex-client/tests/redaction.test.ts`
- Create: `packages/weex-client/tests/fixtures/signing-vectors.json`

- [ ] **Step 1: Write failing golden-vector tests**

```ts
import { expect, it } from "vitest";
import {
  buildSignaturePayload,
  canonicalJson,
  canonicalQuery,
  signWeexRequest,
} from "../src/signing";

it("signs the exact transmitted query and body", async () => {
  const query = canonicalQuery([["symbol", "BTCUSDT"], ["note", "a b"]]);
  const body = canonicalJson({ quantity: "0.01", side: "BUY" });
  const payload = buildSignaturePayload({
    timestamp: "1591089508404",
    method: "post",
    requestPath: "/api/v3/order",
    query,
    body,
  });
  expect(query).toBe("note=a%20b&symbol=BTCUSDT");
  expect(payload).toBe(
    "1591089508404POST/api/v3/order?note=a%20b&symbol=BTCUSDT" + body,
  );
  expect(await signWeexRequest(payload, "test-secret")).toMatch(/^[A-Za-z0-9+/]+=*$/);
});
```

```ts
import { expect, it } from "vitest";
import { redactSensitive } from "../src/redaction";

it("redacts secrets recursively", () => {
  expect(redactSensitive({
    "ACCESS-KEY": "abc",
    nested: { passphrase: "def", value: 1 },
  })).toEqual({
    "ACCESS-KEY": "[REDACTED]",
    nested: { passphrase: "[REDACTED]", value: 1 },
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/weex-client/tests/signing.test.ts packages/weex-client/tests/redaction.test.ts`

Expected: FAIL with missing `signing` and `redaction` modules.

- [ ] **Step 3: Implement the exact signing surface**

```ts
export interface SigningInput {
  timestamp: string;
  method: "GET" | "POST" | "DELETE" | Lowercase<"GET" | "POST" | "DELETE">;
  requestPath: string;
  query: string;
  body: string;
}

export function canonicalQuery(entries: readonly [string, string][]): string;
export function canonicalJson(value: unknown): string;
export function buildSignaturePayload(input: SigningInput): string;
export function signWeexRequest(payload: string, secret: string): Promise<string>;
export function buildPrivateHeaders(input: {
  apiKey: string;
  passphrase: string;
  timestamp: string;
  signature: string;
}): Record<string, string>;
```

Use Web Crypto HMAC-SHA256 and Base64. Sort query keys, use RFC3986 percent encoding, recursively sort JSON object keys, and sign the same body string passed to transport. Redact key names case-insensitively: apiKey, secretKey, passphrase, access-key, access-sign, access-passphrase, authorization, and signature.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @cryptobot-labs/weex-client test`

Expected: all signing and redaction vectors PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/weex-client package.json pnpm-lock.yaml
git commit -m "feat(weex): add canonical request signing"
```

---

### Task 3: Add validated WEEX transport, clock safety, instruments, and candles

**Files:**
- Create: `packages/weex-client/src/transport.ts`
- Create: `packages/weex-client/src/clock.ts`
- Create: `packages/weex-client/src/errors.ts`
- Create: `packages/weex-client/src/schemas.ts`
- Create: `packages/weex-client/src/instruments.ts`
- Create: `packages/weex-client/src/market-data.ts`
- Create: `packages/weex-client/tests/clock.test.ts`
- Create: `packages/weex-client/tests/transport.test.ts`
- Create: `packages/weex-client/tests/market-data.test.ts`
- Create: `packages/weex-client/tests/fixtures/candles.json`

- [ ] **Step 1: Write failing origin, clock, and gap tests**

```ts
import { expect, it } from "vitest";
import { WeexClock } from "../src/clock";
import { validateCandleDataset } from "../src/market-data";

it("rejects stale private-request time and candle gaps", () => {
  const clock = new WeexClock(() => 100_000);
  clock.recordServerTime(100_000, 99_900, 100_100);
  expect(() => clock.assertPrivateRequestWindow(31_000)).toThrow("clock");

  expect(validateCandleDataset([
    { openTime: 0, closeTime: 59_999, open: "1", high: "1", low: "1", close: "1", volume: "1", complete: true },
    { openTime: 120_000, closeTime: 179_999, open: "1", high: "1", low: "1", close: "1", volume: "1", complete: true },
  ], 60_000).gaps).toEqual([{ from: 60_000, to: 119_999 }]);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/weex-client/tests/clock.test.ts packages/weex-client/tests/market-data.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement injected transport and public client**

```ts
export interface HttpRequest {
  method: "GET" | "POST" | "DELETE";
  url: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

export class WeexPublicClient {
  constructor(private readonly transport: HttpTransport);
  fetchCandles(request: HistoricalCandleRequest): Promise<readonly Candle[]>;
  collectHistoricalCandles(request: HistoricalCandleRequest): Promise<HistoricalDataset>;
  getInstrumentRules(market: Market, symbol: string): Promise<InstrumentRules>;
}
```

Permit only `https://api-spot.weex.com` and `https://api-contract.weex.com` in the production transport. Tests inject a fake transport. Normalize reversed responses, deduplicate equal timestamps, reject malformed decimals, report gaps, and exclude incomplete final candles. Spot uses `/api/v3/market/klines`; futures history uses `/capi/v3/market/historyKlines`. Never invent spot pagination parameters not documented by the live schema.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @cryptobot-labs/weex-client test`

Expected: clock midpoint, origin allowlist, schema, pagination, deduplication, and gap tests PASS without network access.

- [ ] **Step 5: Commit**

```bash
git add packages/weex-client
git commit -m "feat(weex): add validated market data transport"
```

---

### Task 4: Add the historical backtest engine and provenance

**Files:**
- Create: `packages/trading-core/src/backtest/types.ts`
- Create: `packages/trading-core/src/backtest/accounting.ts`
- Create: `packages/trading-core/src/backtest/engine.ts`
- Create: `packages/trading-core/src/backtest/metrics.ts`
- Create: `packages/trading-core/src/backtest/provenance.ts`
- Create: `packages/trading-core/tests/backtest-accounting.test.ts`
- Create: `packages/trading-core/tests/historical-backtest.test.ts`
- Create: `packages/trading-core/tests/backtest-reproducibility.test.ts`
- Create: `packages/trading-core/tests/fixtures/btcusdt-1h.json`

- [ ] **Step 1: Write the failing no-lookahead test**

```ts
import { expect, it } from "vitest";
import { runHistoricalBacktest } from "../src/backtest/engine";

it("evaluates candle N and fills at candle N+1 open with adverse slippage", async () => {
  const result = await runHistoricalBacktest({
    dataset: fixedCandles,
    evaluator: buyFirstCompletedCandleThenClose,
    initialCapital: "1000",
    feeRate: "0.001",
    slippageRate: "0.002",
    leverage: "1",
    funding: [],
    gapPolicy: "fail",
    engineVersion: "1",
    configHash: "config",
    strategyHash: "strategy",
  });
  expect(result.trades[0].entryPrice).toBe("101.202");
  expect(result.provenance.dataSource).toBe("WEEX");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/trading-core/tests/historical-backtest.test.ts`

Expected: FAIL because `runHistoricalBacktest` does not exist.

- [ ] **Step 3: Implement the historical API**

```ts
export async function runHistoricalBacktest(
  request: HistoricalBacktestRequest,
): Promise<HistoricalBacktestResult>;
```

Use Decimal.js for balances, fees, slippage, funding, realized and unrealized PnL. Evaluate only completed candle N and fill at N+1 open. Record source, requested/fetched range, gaps, fees, slippage, funding, market, symbol, interval, engine/config/strategy hashes, and dataset digest. A gap policy of `fail` throws; `disclose` records gaps and prevents a “complete” badge.

- [ ] **Step 4: Verify GREEN and preserve preview behavior**

Run:

```bash
pnpm --filter @cryptobot-labs/trading-core test
pnpm test -- tests/backtest.test.ts
```

Expected: historical accounting and byte-identical reproducibility PASS; the existing synthetic preview tests remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/trading-core package.json pnpm-lock.yaml
git commit -m "feat(core): add historical backtesting"
```

---

### Task 5: Implement mandatory risk, idempotent orders, reconciliation, and emergency stop

**Files:**
- Create: `packages/trading-core/src/risk/types.ts`
- Create: `packages/trading-core/src/risk/evaluate.ts`
- Create: `packages/trading-core/src/risk/live-unlock.ts`
- Create: `packages/trading-core/src/orders/types.ts`
- Create: `packages/trading-core/src/orders/client-order-id.ts`
- Create: `packages/trading-core/src/orders/state-machine.ts`
- Create: `packages/trading-core/src/orders/reconciliation.ts`
- Create: `packages/trading-core/src/orders/exchange-port.ts`
- Create: `packages/trading-core/src/reliability/circuit-breaker.ts`
- Create: `packages/trading-core/src/execution/coordinator.ts`
- Create: `packages/trading-core/tests/risk.test.ts`
- Create: `packages/trading-core/tests/risk-properties.test.ts`
- Create: `packages/trading-core/tests/live-unlock.test.ts`
- Create: `packages/trading-core/tests/order-state-machine.test.ts`
- Create: `packages/trading-core/tests/reconciliation.test.ts`
- Create: `packages/trading-core/tests/emergency-stop.test.ts`

- [ ] **Step 1: Write failing boundary and timeout tests**

```ts
it("blocks an order at any missing mandatory limit", () => {
  expect(evaluateLiveUnlock({
    credentialVerified: true,
    permissions: { read: true, spot: true, futures: false, unknownExtraScope: false },
    policy: { ...validPolicy, maximumOrderNotional: null },
    typedBotName: "Orbit",
    expectedBotName: "Orbit",
    acceptedRisk: true,
  })).toEqual({ allowed: false, reason: "missing-maximum-order-notional" });
});

it("moves submission timeout to unknown without retry", () => {
  const next = transitionOrder(submittingOrder, { type: "submit-timeout", at: 10 });
  expect(next.status).toBe("unknown");
  expect(nextReconciliationAction(next)).toBe("query-by-client-id");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/trading-core/tests/risk.test.ts packages/trading-core/tests/order-state-machine.test.ts`

Expected: FAIL with missing risk and order modules.

- [ ] **Step 3: Implement stable APIs**

```ts
export function evaluateOrderRisk(
  policy: RiskPolicy,
  context: RiskContext,
  intent: OrderIntent,
  instrument: InstrumentRules,
): RiskDecision;

export function evaluateLiveUnlock(input: LiveUnlockInput): LiveUnlockResult;

export async function deriveClientOrderId(input: {
  deploymentId: string;
  configurationVersion: string;
  signalId: string;
  sequence: number;
}): Promise<string>;

export function transitionOrder(order: TrackedOrder, event: OrderEvent): TrackedOrder;
export function reconcileOrder(input: ReconciliationInput): ReconciliationResult;

export interface ExchangeExecutionPort {
  submit(intent: ApprovedOrderIntent): Promise<SubmitOutcome>;
  findByClientOrderId(query: OrderQuery): Promise<ExchangeOrderSnapshot | null>;
  cancel(query: OrderQuery): Promise<CancelOutcome>;
}
```

Use fast-check to cover equality boundaries and invalid decimals. Enforce allowed symbols, order/position/total exposure, simultaneous positions, realized plus unrealized daily loss, leverage, slippage, cooldown, consecutive failures, price freshness, quantity step, and minimums. The coordinator order is signal → normalized intent → risk → submitting → exchange. `emergencyStop()` synchronously blocks new orders; cancel-open-orders and close-positions remain separate methods.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @cryptobot-labs/trading-core test`

Expected: all boundary, property, transition, duplicate-event, partial-fill, cancel-race, unknown-order, reconciliation, circuit-breaker, and emergency-stop tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trading-core package.json pnpm-lock.yaml
git commit -m "feat(core): enforce live risk and order safety"
```

---

### Task 6: Implement private WEEX account, order, demo, and stream adapters

**Files:**
- Create: `packages/weex-client/src/private-client.ts`
- Create: `packages/weex-client/src/orders.ts`
- Create: `packages/weex-client/src/execution-adapter.ts`
- Create: `packages/weex-client/src/websocket.ts`
- Create: `packages/weex-client/tests/private-client.test.ts`
- Create: `packages/weex-client/tests/execution-adapter.test.ts`
- Create: `packages/weex-client/tests/websocket.test.ts`

- [ ] **Step 1: Write a failing “one submit only” test**

```ts
it("does not resubmit after an ambiguous POST timeout", async () => {
  const transport = new ScriptedTransport([
    { type: "timeout-after-send" },
    { status: 200, body: { clientOrderId: "cbl-1", status: "FILLED" } },
  ]);
  const client = createPrivateClient({ transport, credentials, clock });
  const outcome = await client.submitOrder(approvedIntent);
  expect(outcome).toEqual({ kind: "unknown", clientOrderId: "cbl-1" });
  expect(transport.requests.filter((request) => request.method === "POST")).toHaveLength(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/weex-client/tests/private-client.test.ts`

Expected: FAIL because private client does not exist.

- [ ] **Step 3: Implement explicit mode routing**

```ts
export class WeexPrivateClient {
  verifyAccount(market: Market): Promise<VerifiedAccountSummary>;
  submitOrder(intent: ApprovedOrderIntent): Promise<SubmitOutcome>;
  findOrderByClientOrderId(query: OrderQuery): Promise<ExchangeOrderSnapshot | null>;
  cancelOrder(query: OrderQuery): Promise<CancelOutcome>;
}

export class WeexExecutionAdapter implements ExchangeExecutionPort {}
```

Spot live uses `/api/v3`, futures live uses `/capi/v3`, and futures demo uses `/capi/v3/sim`. There is no spot demo adapter. Private POST has zero automatic retries. Safe GET retry is bounded to explicit network, 429, and 5xx cases. Validate precision before transport, sign the exact transmitted string, pause on clock/auth/permission errors, respond to WebSocket ping, and reconcile private stream events with REST snapshots.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @cryptobot-labs/weex-client test`

Expected: mode routing, signature/body identity, precision, clock, error mapping, timeout ambiguity, lookup, heartbeat, and event mapping PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/weex-client
git commit -m "feat(weex): add private execution adapters"
```

---

### Task 7: Add D1 persistence and append-only audit records

**Files:**
- Modify: `.openai/hosting.json`
- Modify: `db/schema.ts`
- Modify: `db/index.ts`
- Create: `lib/control-plane/types.ts`
- Create: `lib/control-plane/schemas.ts`
- Create: `lib/control-plane/evidence.ts`
- Create: `db/repositories/users.ts`
- Create: `db/repositories/devices.ts`
- Create: `db/repositories/backtests.ts`
- Create: `db/repositories/deployments.ts`
- Create: `db/repositories/activity.ts`
- Create: `tests/db-schema.test.ts`
- Create: `tests/control-plane-contracts.test.ts`
- Create: generated `drizzle/*.sql`

- [ ] **Step 1: Write the failing schema ownership test**

```ts
import { expect, it } from "vitest";
import {
  auditEvents,
  devices,
  pairingCodes,
  users,
} from "../db/schema";

it("defines owned device records and append-only audit events", () => {
  expect(users).toBeDefined();
  expect(devices.userId).toBeDefined();
  expect(pairingCodes.codeHash).toBeDefined();
  expect(auditEvents.payloadJson).toBeDefined();
  expect("secretKey" in auditEvents).toBe(false);
  expect("passphrase" in devices).toBe(false);
});
```

Also assert the shared control-plane vocabulary:

```ts
export type EvidenceLevel =
  | "preview"
  | "historical"
  | "paper"
  | "futures-demo"
  | "live";
export type RunMode = "paper" | "futures-demo" | "live";
export type CommandType =
  | "deploy"
  | "pause"
  | "resume-paper"
  | "request-live-unlock"
  | "stop-new-orders"
  | "cancel-open-orders"
  | "close-positions"
  | "revalidate-connection"
  | "erase-local-credentials";
```

Strict DTO schemas must reject unknown fields and the names secretKey, passphrase, ACCESS-SIGN, authorization, and rawAccount.

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- tests/db-schema.test.ts`

Expected: FAIL because the schema is empty.

- [ ] **Step 3: Define tables and indexes**

Create Drizzle SQLite tables:

- `users`: id, normalizedEmail unique, displayName, createdAt, updatedAt.
- `devices`: id, userId, name, platform, publicKeyJwk, status, pairedAt, lastSeenAt, revokedAt.
- `device_credentials`: deviceId, credentialHash, expiresAt, revokedAt. The opaque plaintext credential is returned once and never stored.
- `pairing_codes`: id, userId, codeHash unique, expiresAt, consumedAt, createdAt.
- `device_nonces`: deviceId plus nonce unique, timestamp, expiresAt.
- `strategies` and `strategy_versions`: ownership, immutable config/source hashes and JSON.
- `backtest_jobs`, `backtest_datasets`, `backtest_results`: status, provenance, metrics, error, ownership.
- `deployments` and `risk_policies`: mode, strategyVersionId, deviceId, state, mandatory decimal-string limits.
- `run_heartbeats` and `position_snapshots`.
- `orders` and `fills`: client order ID unique per deployment, exchange IDs, states, decimal strings.
- `commands` and `command_acknowledgements`.
- `audit_events`: append-only actor, device, type, correlationId, payloadJson, occurredAt.

Repository methods always require `userId` or `deviceId`. Do not export generic unscoped list/update methods. Enable D1 with `"d1": "DB"` and keep R2 null until an export exceeds D1 suitability.

The migration must install UPDATE and DELETE triggers on `audit_events` that abort the statement, so application code cannot rewrite or delete audit history.

- [ ] **Step 4: Generate and inspect migration**

Run:

```bash
pnpm db:generate
rg -n "CREATE TABLE|CREATE INDEX|secret|passphrase" drizzle
pnpm test -- tests/db-schema.test.ts
```

Expected: migration creates every table/index, contains no credential column, and schema test PASS.

- [ ] **Step 5: Commit**

```bash
git add .openai/hosting.json db drizzle tests/db-schema.test.ts
git commit -m "feat(data): add trading control-plane records"
```

---

### Task 8: Add API identity, same-origin protection, pairing, and device signatures

**Files:**
- Create: `lib/server/auth.ts`
- Create: `lib/server/origin.ts`
- Create: `lib/server/pairing.ts`
- Create: `lib/server/device-signature.ts`
- Create: `lib/server/http.ts`
- Create: `app/api/pairing-codes/route.ts`
- Create: `app/api/agent/pairings/consume/route.ts`
- Create: `app/api/agent/bootstrap/complete/route.ts`
- Create: `app/api/devices/[id]/route.ts`
- Create: `tests/api-auth.test.ts`
- Create: `tests/pairing.test.ts`
- Create: `tests/device-signature.test.ts`

- [ ] **Step 1: Write failing expiry, replay, and ownership tests**

```ts
it("consumes a five-minute pairing code exactly once", async () => {
  const code = await service.issueCode({ userId: "u1", now: 0 });
  expect(await service.consumeCode({ code: code.plaintext, publicKeyJwk, now: 299_999 })).toMatchObject({ userId: "u1" });
  await expect(service.consumeCode({ code: code.plaintext, publicKeyJwk, now: 300_000 }))
    .rejects.toThrow("consumed");
});

it("rejects a reused device nonce", async () => {
  expect(await verifyDeviceRequest(validRequest)).toMatchObject({ deviceId: "d1" });
  await expect(verifyDeviceRequest(validRequest)).rejects.toThrow("nonce");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- tests/api-auth.test.ts tests/pairing.test.ts tests/device-signature.test.ts`

Expected: FAIL with missing server modules.

- [ ] **Step 3: Implement pure services and thin routes**

```ts
export function normalizeUserEmail(email: string): string;
export async function requireApiUser(): Promise<
  { ok: true; user: ApiUser } | { ok: false; response: Response }
>;
export function requireSameOrigin(request: Request): void;

export interface PairingService {
  issueCode(input: { userId: string; now: number }): Promise<{ plaintext: string; expiresAt: number }>;
  consumeCode(input: { code: string; publicKeyJwk: JsonWebKey; name: string; platform: "win32" | "darwin"; now: number }): Promise<PairingBootstrap>;
  activateDevice(input: PairingActivation): Promise<DeviceCredential>;
}
```

Hash pairing and bootstrap tokens with SHA-256 before storage. Use random 128-bit entropy, five-minute code expiry, one-minute bootstrap expiry, atomic consume, Ed25519 device keys, timestamp window, request-body SHA-256, nonce uniqueness, and revocation checks. Device canonical string is method, pathname+query, timestamp, nonce, and body digest separated by newline.

Device requests use `Authorization: Device <opaque>` plus `X-CBL-Device-Id`, `X-CBL-Device-Timestamp`, `X-CBL-Device-Nonce`, and `X-CBL-Device-Signature`. The server stores only the opaque credential hash. The complete-bootstrap endpoint returns the plaintext credential once after a signed challenge.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test -- tests/api-auth.test.ts tests/pairing.test.ts tests/device-signature.test.ts`

Expected: missing identity returns 401; cross-origin returns 403; expiry, atomic consumption, signature tamper, replay, revocation, and ownership tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server app/api tests
git commit -m "feat(control): add secure device pairing"
```

---

### Task 9: Add device telemetry, commands, acknowledgements, and audit ingestion

**Files:**
- Create: `lib/server/device-events.ts`
- Create: `lib/server/commands.ts`
- Create: `app/api/agent/heartbeat/route.ts`
- Create: `app/api/agent/events/route.ts`
- Create: `app/api/agent/commands/route.ts`
- Create: `app/api/agent/commands/[id]/ack/route.ts`
- Create: `tests/device-events.test.ts`
- Create: `tests/commands.test.ts`

- [ ] **Step 1: Write the failing secret-rejection test**

```ts
it("rejects credential material in agent events", () => {
  expect(() => parseDeviceEvent({
    type: "connection-verified",
    occurredAt: 1,
    payload: { apiKeySuffix: "1234", secretKey: "leak" },
  })).toThrow("credential");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- tests/device-events.test.ts tests/commands.test.ts`

Expected: FAIL because event and command parsers do not exist.

- [ ] **Step 3: Implement strict event and command schemas**

Accepted event types are heartbeat, connection-verified, signal, risk-block, order-state, fill, deployment-state, key-rotated, key-erased, and agent-error. Strictly allowlisted payload fields reject credential/header/signature names recursively. Commands use the exact shared CommandType vocabulary: deploy, pause, resume-paper, request-live-unlock, stop-new-orders, cancel-open-orders, close-positions, revalidate-connection, and erase-local-credentials. Every command has version, expiry, correlation ID, expected deployment version, and explicit acknowledgement.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm test -- tests/device-events.test.ts tests/commands.test.ts`

Expected: secret rejection, ownership, stale command, duplicate acknowledgement, optimistic-version conflict, and append-only audit tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/server app/api/agent tests
git commit -m "feat(control): add agent telemetry and commands"
```

---

### Task 10: Add authenticated historical backtest APIs and provenance UI

**Files:**
- Create: `lib/server/backtests.ts`
- Create: `app/api/backtests/route.ts`
- Create: `app/api/backtests/[id]/route.ts`
- Create: `app/backtests/page.tsx`
- Create: `components/backtests/BacktestRequestForm.tsx`
- Create: `components/backtests/BacktestResultCard.tsx`
- Create: `components/backtests/BacktestProvenance.tsx`
- Modify: `components/workshop/BacktestPanel.tsx`
- Modify: `app/workshop/page.tsx`
- Create: `tests/historical-backtest-api.test.ts`
- Create: `tests/historical-backtest-ui.test.tsx`

- [ ] **Step 1: Write failing evidence-label tests**

```tsx
it("separates quick simulation from WEEX historical evidence", async () => {
  render(<BacktestResultCard result={historicalResult} />);
  expect(screen.getByText("歷史回測")).toBeInTheDocument();
  expect(screen.getByText("WEEX 公開行情")).toBeInTheDocument();
  expect(screen.queryByText("實盤績效")).not.toBeInTheDocument();
  expect(screen.getByText(/資料缺口：0/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- tests/historical-backtest-api.test.ts tests/historical-backtest-ui.test.tsx`

Expected: FAIL with missing route/components.

- [ ] **Step 3: Implement the bounded server workflow**

`POST /api/backtests` accepts strict symbol, market, interval, start/end, initial capital, fee, slippage, leverage, funding mode, strategy version, and gap policy. It authenticates the user, creates a job, fetches validated public candles through injected WeexPublicClient, runs `runHistoricalBacktest`, persists dataset digest and result, and returns the job. `GET /api/backtests/[id]` enforces ownership. Until Sites exposes and the project verifies a background queue primitive, the route performs a bounded synchronous run and reports queued → fetching-data → running → succeeded/failed truthfully; it must not fake an asynchronous worker.

The workshop retains the existing quick simulation button and adds a distinct historical-backtest action. UI always shows evidence type, source, fetched range, data completeness, fee/slippage/funding assumptions, engine version, and disclaimer.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm test -- tests/historical-backtest-api.test.ts tests/historical-backtest-ui.test.tsx tests/workshop-flow.test.tsx
pnpm run build
```

Expected: API ownership/failure/provenance tests PASS; workshop labels remain distinct; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/server/backtests.ts app/api/backtests app/backtests components/backtests components/workshop/BacktestPanel.tsx app/workshop tests
git commit -m "feat(backtest): add WEEX historical evidence"
```

---

### Task 11: Add connections, runs, activity, risk, and softened WEEX UX

**Files:**
- Create: `lib/server/live-gates.ts`
- Create: `lib/server/activity-export.ts`
- Create: `app/api/connections/route.ts`
- Create: `app/api/devices/[id]/commands/route.ts`
- Create: `app/api/runs/route.ts`
- Create: `app/api/runs/[id]/route.ts`
- Create: `app/api/runs/[id]/commands/route.ts`
- Create: `app/api/runs/[id]/live-unlock/route.ts`
- Create: `app/api/activity/route.ts`
- Create: `app/api/activity/export/route.ts`
- Create: `app/connections/page.tsx`
- Create: `app/runs/page.tsx`
- Create: `app/runs/[id]/page.tsx`
- Create: `app/activity/page.tsx`
- Create: `components/connections/AgentDownloadCard.tsx`
- Create: `components/connections/PairingCodeCard.tsx`
- Create: `components/connections/DeviceCard.tsx`
- Create: `components/runs/RunCard.tsx`
- Create: `components/runs/RiskPolicyForm.tsx`
- Create: `components/runs/LiveUnlockDialog.tsx`
- Create: `components/runs/EmergencyStopDialog.tsx`
- Create: `components/activity/ActivityTable.tsx`
- Modify: `components/SiteHeader.tsx`
- Modify: `components/SiteFooter.tsx`
- Modify: `app/page.tsx`
- Modify: `app/bots/page.tsx`
- Modify: `app/bots/[id]/page.tsx`
- Modify: `app/leaderboard/page.tsx`
- Modify: `components/LeaderboardTable.tsx`
- Modify: `lib/site-metadata.ts`
- Modify: `lib/strategy-validation.ts`
- Modify: `lib/bot-package.ts`
- Replace: `public/og.png`
- Create: `tests/live-control-ui.test.tsx`
- Create: `tests/live-control-routes.test.ts`
- Create: `tests/activity-export.test.ts`
- Create: `tests/copy-migration.test.ts`
- Modify: existing navigation, workshop, package, metadata, and rendered HTML tests

- [ ] **Step 1: Write failing safety and copy tests**

```tsx
it("defaults to paper and requires typed confirmation for live", async () => {
  const user = userEvent.setup();
  render(<LiveUnlockDialog botName="Orbit" policy={validPolicy} permissions={verifiedPermissions} />);
  expect(screen.getByText("模擬運行（預設）")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "確認並啟用實盤" })).toBeDisabled();
  await user.type(screen.getByLabelText("輸入機器人名稱"), "Orbit");
  await user.click(screen.getByRole("checkbox", { name: /了解所有交易均可能產生損失/ }));
  expect(screen.getByRole("button", { name: "確認並啟用實盤" })).toBeEnabled();
});
```

```ts
it("removes exclusivity language without claiming other exchanges", () => {
  const source = allUserVisibleSource();
  expect(source).not.toMatch(/WEEX ONLY|只為 WEEX 而生|WEEX 專屬|只支援 WEEX/);
  expect(source).toMatch(/推薦使用 WEEX API|WEEX API · 推薦/);
  expect(source).not.toMatch(/支援 Binance|支援多交易所/);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- tests/live-control-ui.test.tsx tests/live-control-routes.test.ts tests/activity-export.test.ts tests/copy-migration.test.ts`

Expected: FAIL because new UI is missing and old exclusivity copy remains.

- [ ] **Step 3: Implement the authenticated control surfaces**

`/connections` shows Windows/macOS downloads, five-minute pairing code, device status, masked API suffix, permission summary, last verification, revalidate guidance, revoke, and erase-local reminder. It never renders API Secret inputs.

`/runs` shows paper/demo/live evidence, agent health, PnL, positions, open orders, last signal, risk blocks, and controls. Live unlock requires verified local permission summary, every non-null risk limit, typed bot name, and risk checkbox. Emergency stop first blocks new orders; cancelling open orders is a separate confirmation; closing positions is not offered as a side effect.

`/activity` exports CSV/JSON and displays UTC plus local time, actor/device, strategy/config versions, script hash, reason, risk decision, client/exchange order IDs, status, and correlation ID.

The connections API returns provider, masked suffix, permissions, verifiedAt, status, and hasLocalCredential only. New runs are always paper. Live-unlock creates a versioned request for the agent; the agent must independently revalidate credential, permissions, product metadata, and risk. Stop-new-orders, cancel-open-orders, and close-positions are three different commands; close positions requires its own high-risk confirmation.

Activity APIs enforce owner, cursor, time-range, and result limits. CSV export uses an allowlist of columns and prefixes cells beginning with equals, plus, minus, at-sign, tab, or carriage return so spreadsheet software cannot execute formulas.

Replace all exclusivity copy and regenerate the social image with the approved brand copy. Keep technical imports restricted to the implemented WEEX adapter, but change validation errors to `目前可用的實盤連線為 WEEX API`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm test
pnpm run lint
pnpm run build
```

Expected: all UI, navigation, copy, metadata, package, and existing tests PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app components lib public/og.png tests
git commit -m "feat(web): add trading control center"
```

---

### Task 12: Scaffold the Electron agent with secure IPC and OS-backed vault

**Files:**
- Create: `apps/agent/package.json`
- Create: `apps/agent/forge.config.ts`
- Create: `apps/agent/tsconfig.json`
- Create: `apps/agent/vite.main.config.ts`
- Create: `apps/agent/vite.preload.config.ts`
- Create: `apps/agent/vite.renderer.config.ts`
- Create: `apps/agent/src/main/index.ts`
- Create: `apps/agent/src/main/windows.ts`
- Create: `apps/agent/src/main/ipc.ts`
- Create: `apps/agent/src/main/vault.ts`
- Create: `apps/agent/src/main/runtime-supervisor.ts`
- Create: `apps/agent/src/runtime/index.ts`
- Create: `apps/agent/src/runtime/runtime-protocol.ts`
- Create: `apps/agent/src/preload/index.ts`
- Create: `apps/agent/src/renderer/App.tsx`
- Create: `apps/agent/src/shared/ipc-contract.ts`
- Create: `apps/agent/tests/vault.test.ts`
- Create: `apps/agent/tests/ipc.test.ts`
- Create: `apps/agent/tests/runtime-supervisor.test.ts`

- [ ] **Step 1: Write failing vault and IPC tests**

```ts
it("encrypts credentials and never exposes a read-secret IPC method", async () => {
  const vault = createCredentialVault(fakeSafeStorage, memoryFileStore);
  await vault.save({ apiKey: "key-1234", secretKey: "secret", passphrase: "phrase" });
  expect(memoryFileStore.bytes.toString()).not.toContain("secret");
  expect(await vault.metadata()).toEqual({ apiKeySuffix: "1234", configured: true });
  expect(Object.keys(agentApi)).not.toContain("readCredentials");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/agent/tests/vault.test.ts apps/agent/tests/ipc.test.ts`

Expected: FAIL because the agent workspace does not exist.

- [ ] **Step 3: Implement the minimal secure shell**

Use Electron with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict Content Security Policy, no remote module, deny navigation/new windows, and a typed preload allowlist.

```ts
export interface AgentRendererApi {
  getStatus(): Promise<AgentStatus>;
  saveCredentials(input: CredentialInput): Promise<CredentialMetadata>;
  verifyCredentials(): Promise<VerifiedConnection>;
  eraseCredentials(): Promise<void>;
  pair(input: PairingInput): Promise<PairingResult>;
  setStartAtLogin(enabled: boolean): Promise<void>;
  emergencyStop(): Promise<void>;
}
```

The main-process vault checks `safeStorage.isAsyncEncryptionAvailable()`, uses asynchronous encrypt/decrypt, writes only encrypted bytes with owner-only permissions and atomic rename, supports re-encryption after key rotation, returns masked metadata only, and zeroes temporary buffers where possible. Start-at-login is explicit opt-in through `app.setLoginItemSettings`. Closing the window keeps a tray agent running; Quit is explicit.

Launch the trusted long-running runtime with Electron `utilityProcess.fork` and a narrow validated message protocol. Renderer and preload never receive credentials. The supervisor enforces startup timeout, graceful shutdown deadline, crash restart limits, and a circuit breaker; crash/public messages pass through credential redaction before logging or IPC.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @cryptobot-labs/agent test
pnpm --filter @cryptobot-labs/agent typecheck
```

Expected: vault ciphertext, unavailable-encryption failure, erase, rotation, IPC allowlist, CSP, navigation denial, and startup tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(agent): add secure desktop shell"
```

---

### Task 13: Pair the agent and synchronize signed commands and telemetry

**Files:**
- Create: `apps/agent/src/main/device-identity.ts`
- Create: `apps/agent/src/main/pairing-client.ts`
- Create: `apps/agent/src/main/control-client.ts`
- Create: `apps/agent/src/main/telemetry-buffer.ts`
- Create: `apps/agent/src/renderer/PairingWizard.tsx`
- Create: `apps/agent/src/renderer/ConnectionWizard.tsx`
- Create: `apps/agent/tests/pairing-client.test.ts`
- Create: `apps/agent/tests/control-client.test.ts`
- Create: `apps/agent/tests/telemetry-buffer.test.ts`

- [ ] **Step 1: Write the failing signed-request test**

```ts
it("signs device requests and never serializes WEEX secrets", async () => {
  const request = await client.createSignedRequest("/api/agent/events", {
    type: "connection-verified",
    payload: { apiKeySuffix: "1234", permissions: ["read", "spot"] },
  }, 1000);
  expect(request.headers["X-CBL-Device-Signature"]).toBeTruthy();
  expect(JSON.stringify(request)).not.toMatch(/secret|passphrase/i);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @cryptobot-labs/agent test -- pairing-client.test.ts control-client.test.ts telemetry-buffer.test.ts`

Expected: FAIL with missing clients.

- [ ] **Step 3: Implement pairing and offline buffering**

Generate an Ed25519 device key pair locally. Send only the public JWK with the pairing code. Store the private key encrypted with safeStorage. Sign method, path/query, timestamp, nonce, and body digest. Poll commands with bounded backoff, validate version/expiry/deployment version before acting, and acknowledge every command.

Telemetry is strict and non-secret. Buffer encrypted events locally while offline, keep stable event IDs for idempotent upload, cap disk size, retain emergency-stop events ahead of lower-priority heartbeats, and erase acknowledged batches.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @cryptobot-labs/agent test`

Expected: pairing expiry, signature vectors shared with server, nonce uniqueness, revocation, offline buffer, replay-safe upload, and credential non-serialization PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent
git commit -m "feat(agent): pair devices with the control plane"
```

---

### Task 14: Add the QuickJS signal sandbox and trusted execution coordinator

**Files:**
- Create: `packages/trading-core/src/sandbox/contracts.ts`
- Create: `packages/trading-core/src/sandbox/quickjs-runner.ts`
- Create: `packages/trading-core/src/sandbox/script-hash.ts`
- Create: `packages/trading-core/src/sandbox/index.ts`
- Create: `packages/trading-core/tests/quickjs-runner.test.ts`
- Create: `packages/trading-core/tests/sandbox-limits.test.ts`
- Create: `apps/agent/src/runtime/strategy-worker.ts`
- Create: `apps/agent/src/runtime/execution-runtime.ts`
- Create: `apps/agent/tests/execution-runtime.test.ts`

- [ ] **Step 1: Write failing capability-denial tests**

```ts
it.each(["fetch", "WebSocket", "process", "require"])(
  "does not expose %s to custom strategy code",
  async (name) => {
    const result = await sandbox.evaluate({
      source: "export default () => ({ action: typeof " + name + " === 'undefined' ? 'hold' : 'buy', reason: 'capability-check' })",
      input: frozenInput,
      now: 1000,
      randomSeed: "seed",
    });
    expect(result.signal.action).toBe("hold");
  },
);
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/trading-core/tests/quickjs-runner.test.ts packages/trading-core/tests/sandbox-limits.test.ts`

Expected: FAIL because the sandbox does not exist.

- [ ] **Step 3: Implement the isolated signal-only API**

```ts
export interface StrategySandbox {
  evaluate(input: {
    source: string;
    input: Readonly<StrategyInput>;
    now: number;
    randomSeed: string;
  }): Promise<{ signal: StrategySignal; scriptHash: string; durationMs: number }>;
  dispose(): Promise<void>;
}

export function createQuickJsStrategySandbox(
  budget: { deadlineMs: number; memoryBytes: number; outputBytes: number },
): Promise<StrategySandbox>;
```

Pin QuickJS WebAssembly. Provide no host imports for network, filesystem, process, credentials, modules, or children. Freeze input, replace time/randomness deterministically, enforce a 50 ms live deadline, 250 ms backtest deadline, 8 MiB heap, 512 KiB stack, and 16 KiB output limit, dispose after fault, and restart the dedicated worker. QuickJS runs inside the utility runtime, not the renderer or web worker. The trusted execution runtime passes every signal through `ExecutionCoordinator.propose`; the sandbox never receives an exchange port.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @cryptobot-labs/trading-core test
pnpm --filter @cryptobot-labs/agent test -- execution-runtime.test.ts
```

Expected: capability denial, infinite loop, memory pressure, oversized output, mutation, determinism, hash, restart, and mandatory risk sequencing PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trading-core apps/agent package.json pnpm-lock.yaml
git commit -m "feat(agent): isolate custom strategy signals"
```

---

### Task 15: Implement paper, WEEX futures demo, and live spot/futures runs

**Files:**
- Create: `apps/agent/src/main/connections.ts`
- Create: `apps/agent/src/main/market-stream.ts`
- Create: `apps/agent/src/main/paper-exchange.ts`
- Create: `apps/agent/src/main/run-manager.ts`
- Create: `apps/agent/src/main/emergency-stop.ts`
- Create: `apps/agent/src/renderer/Dashboard.tsx`
- Create: `apps/agent/src/renderer/RiskSetup.tsx`
- Create: `apps/agent/src/renderer/LiveUnlock.tsx`
- Create: `apps/agent/tests/paper-exchange.test.ts`
- Create: `apps/agent/tests/run-manager.test.ts`
- Create: `apps/agent/tests/live-unlock.test.ts`
- Create: `packages/weex-client/tests/mock-weex.integration.test.ts`
- Create: `packages/trading-core/tests/full-execution-flow.test.ts`

- [ ] **Step 1: Write the failing fail-closed integration test**

```ts
it("pauses on stale data and reconciles one ambiguous order without resubmit", async () => {
  const result = await scenario()
    .withPaperDefault()
    .unlockLive(validUnlock)
    .emitSignal("buy")
    .timeoutAfterSubmit()
    .reconcileAsFilled()
    .advanceWithoutMarketData(61_000)
    .run();

  expect(result.postCount).toBe(1);
  expect(result.order.status).toBe("filled");
  expect(result.run.status).toBe("paused");
  expect(result.audit.map((event) => event.type)).toContain("market-data-stale");
  expect(JSON.stringify(result.audit)).not.toMatch(/secret|passphrase/i);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @cryptobot-labs/agent test -- run-manager.test.ts`

Expected: FAIL because run manager is missing.

- [ ] **Step 3: Implement explicit execution modes**

Paper mode uses public prices and deterministic configurable fill/slippage rules. Futures demo uses the documented `/capi/v3/sim` adapter. Live spot/futures use only verified local credentials and the displayed risk envelope. There is no spot demo claim.

The run manager requires fresh market data, clock sync, verified connection, current instrument rules, a non-tripped circuit breaker, and reconciled conflicting orders before submit. It records signals, risk decisions, orders, fills, API errors, key events, and emergency stops. Local emergency stop works without website access; cancel-open-orders is separate; close positions is separate and never automatic.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @cryptobot-labs/trading-core test
pnpm --filter @cryptobot-labs/weex-client test
pnpm --filter @cryptobot-labs/agent test
```

Expected: paper fills, demo route selection, permission checks, typed unlock, stale market, clock drift, 429, auth failure, one-submit ambiguity, reconciliation, circuit breaker, restart recovery, and emergency stop PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent packages
git commit -m "feat(agent): execute paper demo and live runs"
```

---

### Task 16: Package and sign Windows/macOS installers in CI

**Files:**
- Modify: `apps/agent/forge.config.ts`
- Create: `apps/agent/entitlements.plist`
- Create: `apps/agent/assets/`
- Create: `.github/workflows/agent-ci.yml`
- Create: `.github/workflows/agent-release.yml`
- Create: `scripts/verify-agent-artifact.mjs`
- Create: `tests/agent-release-config.test.ts`
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Write the failing release-gate test**

```ts
it("refuses a public release without platform signing inputs", async () => {
  expect(() => validateReleaseEnvironment("darwin", {})).toThrow("APPLE");
  expect(() => validateReleaseEnvironment("win32", {})).toThrow("WINDOWS");
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm test -- tests/agent-release-config.test.ts`

Expected: FAIL because release validation is missing.

- [ ] **Step 3: Configure Forge and workflows**

Electron Forge produces a Windows installer and notarized macOS application. CI on pull requests builds unsigned artifacts labelled `internal-test-unsigned` and runs tests/typecheck. Release workflow requires Apple Developer ID/notary secrets and Windows signing inputs, fails closed when missing, signs/notarizes, generates SHA-256 checksums and SBOM, verifies signatures, and attaches versioned artifacts to a GitHub release.

Enable Electron fuses that disable RunAsNode, NODE_OPTIONS, inspect arguments, and loading application code outside the ASAR; enable cookie encryption and ASAR integrity. The updater accepts only signed HTTPS metadata from the allowlisted release origin and refuses restart while a live deployment is active.

Never commit certificates, passwords, API credentials, pairing secrets, or signing logs. Update the website download manifest only from verified signed release metadata.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm test -- tests/agent-release-config.test.ts
pnpm --filter @cryptobot-labs/agent make
node scripts/verify-agent-artifact.mjs --internal-test apps/agent/out
```

Expected: local platform internal artifact builds and verifies; public mode fails without signing inputs.

- [ ] **Step 5: Commit**

```bash
git add apps/agent .github scripts tests/agent-release-config.test.ts .gitignore README.md
git commit -m "ci(agent): package signed desktop releases"
```

---

### Task 17: Complete integration, security review, deployment, and PR update

**Files:**
- Create: `tests/live-execution-completion.test.ts`
- Create: `docs/security/live-trading-threat-model.md`
- Create: `docs/security/credential-handling.md`
- Create: `docs/operations/agent-release-checklist.md`
- Create: `docs/operations/live-smoke-test-checklist.md`
- Modify: `README.md`
- Modify: `.openai/hosting.json` only if deployment bindings differ from Task 7

- [ ] **Step 1: Write the completion invariant test**

```ts
it("keeps secrets local and evidence classes distinct", async () => {
  const repositoryFiles = await readProjectFiles();
  expect(repositoryFiles.userVisibleText).not.toMatch(/WEEX ONLY|只支援 WEEX/);
  expect(repositoryFiles.browserApiRoutes).not.toMatch(/secretKey|passphrase/);
  expect(repositoryFiles.d1Migration).not.toMatch(/secret_key|passphrase/i);
  expect(repositoryFiles.evidenceLabels).toEqual(
    expect.arrayContaining(["快速模擬", "歷史回測", "模擬運行", "實盤績效"]),
  );
});
```

- [ ] **Step 2: Verify RED before the final documentation and migration fixes**

Run: `pnpm test -- tests/live-execution-completion.test.ts`

Expected: FAIL on any remaining old copy, missing evidence label, or unsafe serialized field.

- [ ] **Step 3: Complete the threat model and operational gates**

Threat model covers stolen local session, malicious strategy script, forged device request, replay, compromised website, telemetry injection, stale market, time drift, API beta schema change, duplicate order, unknown order, rate limits, credential rotation, lost laptop, revoked device, installer supply chain, and emergency stop. Each threat names prevention, detection, recovery, and test evidence.

The live smoke checklist requires a dedicated WEEX account/key, no withdrawal capability, minimum permitted order size, explicit user authorization, current exchange rules, paper/demo success, working emergency stop, and immediate credential revocation procedure. It is never invoked by automated tests.

- [ ] **Step 4: Run the complete evidence gate**

Run:

```bash
pnpm install --frozen-lockfile
pnpm -r test
pnpm -r typecheck
pnpm test
pnpm run lint
pnpm run build
git diff --check
```

Expected: all workspace and legacy tests PASS, typecheck/lint/build succeed, and diff check is clean.

- [ ] **Step 5: Perform manual acceptance without real-money automation**

- Pair one Windows agent and one macOS agent.
- Verify safeStorage persistence, rotation, erase, and masked website metadata.
- Verify restart, start-at-login opt-in, website offline behavior, telemetry recovery, stale data pause, network loss, and local emergency stop.
- Complete one WEEX futures demo order lifecycle.
- Confirm paper spot mode is labelled as CryptoBot Labs simulation.
- Verify responsive and keyboard UX for connections, backtests, runs, activity, live unlock, and emergency stop.
- Do not run a real-money order without the separate approved checklist and explicit authorization.

- [ ] **Step 6: Commit, push, update PR, and redeploy**

```bash
git add tests docs README.md .openai/hosting.json
git commit -m "docs: complete live trading security gates"
git push
```

Update the existing PR description with the new architecture and validation evidence. Save and deploy a new private Sites version only after the exact pushed commit passes the full gate. Verify the deployment URL and authenticated routes.

---

## Plan self-review checklist

- [x] Every design-spec section maps to at least one task.
- [x] Shared type names are identical across core, WEEX client, server, and agent.
- [x] No plan step places SecretKey or Passphrase in the website or D1.
- [x] Synthetic preview remains separate from historical backtest.
- [x] Spot paper mode is not called WEEX demo/testnet.
- [x] Live order POST has no automatic retry.
- [x] Emergency stop, cancel orders, and close positions remain distinct.
- [x] Every production change starts with a failing test and a verified RED result.
- [x] Public release refuses unsigned installers.
- [x] Real-money smoke testing remains manual and separately authorized.
