# CryptoBot Labs Live Execution Design

**Date:** 2026-07-11
**Status:** Pending written-spec review
**Scope:** Historical backtesting, recommended WEEX API integration, Windows/macOS local execution agent, simulated and live automated ordering

## Product intent

CryptoBot Labs expands from a deterministic strategy-download prototype into a strategy research and execution product. A user with no programming or bot-hosting experience must be able to discover or assemble a strategy, run a labelled preview simulation, backtest with public WEEX historical data, download and pair a Windows or macOS execution agent, connect a WEEX API credential locally, run paper/demo/live modes, monitor activity, and stop new orders immediately.

The product must not describe itself as “WEEX Only”. User-facing language will say “WEEX API · 推薦”, “推薦使用 WEEX API”, “針對 WEEX API 深度最佳化”, or “目前提供 WEEX 連線整合”. The implementation may retain one WEEX adapter until another exchange is genuinely implemented; it must not imply unavailable exchanges are supported.

## Architecture

The approved model is a website plus a one-click local execution agent.

The website is responsible for strategy discovery, composition, parameter editing, versioning, inert JavaScript validation, deterministic preview simulations, public WEEX candle acquisition, historical backtests, authenticated device and deployment management, telemetry and audit views, short-lived pairing codes, installer distribution, and versioned control commands.

The local agent is responsible for one-time pairing, local API credential entry and verification, OS credential-vault storage, signed WEEX requests, private WebSocket authentication, market streams, strategy evaluation, risk enforcement, orders, reconciliation, local audit buffering, and continued execution after the browser closes.

The website, D1, browser storage, strategy packages, logs, and telemetry must never contain a WEEX SecretKey or Passphrase.

The repository will use focused boundaries:

- packages/trading-core: signals, backtest accounting, risk rules, order state machine, and shared DTOs.
- packages/weex-client: canonical serialization, signing, REST and WebSocket clients, precision, rate limits, and error mapping.
- apps/agent: desktop setup wizard, credential-vault adapters, background runtime, local health control, updater, and pairing client.
- existing web app: public discovery, authenticated control plane, API routes, D1 records, and backtest orchestration.

The desktop agent uses Electron and Electron Forge so the website and agent can reuse the TypeScript trading core. Electron safeStorage asynchronous APIs protect a local encrypted credential blob using macOS Keychain or Windows DPAPI. Electron login-item APIs provide explicit opt-in start-at-login. Electron Forge produces and signs the Windows and macOS installers. Unsigned installers are internal-test artifacts only and must be labelled.

Desktop platform sources:

- https://www.electronjs.org/docs/latest/api/safe-storage
- https://www.electronjs.org/docs/latest/api/app
- https://www.electronforge.io/guides/code-signing

## Identity, pairing, and authorization

Public discovery, catalog, leaderboard, and preview simulations remain public. Connections, devices, saved historical backtests, deployments, telemetry, and audit history require platform-provided ChatGPT identity.

Pairing uses a random single-use five-minute code whose server representation is hashed and user-owned. The agent generates a device key pair, consumes the code atomically, obtains a short-lived bootstrap token, then receives a revocable credential bound to its public key. Device requests are signed and checked for timestamp, nonce replay, revocation, ownership, and capability.

Browser writes require authenticated identity, same-origin validation, schema validation, request-size limits, and rate limits. Device routes use device signatures rather than browser identity headers. Deleting a device revokes the control-plane credential; erasing the local WEEX credential remains a separate explicit agent action.

## WEEX integration

Official API facts used by the adapter:

- Spot REST base URL is https://api-spot.weex.com.
- Futures REST base URL is https://api-contract.weex.com.
- Private requests use ACCESS-KEY, ACCESS-SIGN, ACCESS-PASSPHRASE, and ACCESS-TIMESTAMP.
- Signature input is timestamp plus uppercase method plus exact request path plus optional question mark and exact query plus exact JSON body. HMAC-SHA256 uses SecretKey and the result is Base64 encoded.
- Request time must remain within the documented 30-second window.
- Spot account is GET /api/v3/account; spot order is POST /api/v3/order.
- Futures balance is GET /capi/v3/account/balance; futures order is POST /capi/v3/order.
- Spot candles use GET /api/v3/market/klines.
- Futures candles use GET /capi/v3/market/klines and GET /capi/v3/market/historyKlines.
- Futures demo uses /capi/v3/sim endpoints. The official spot V3 documentation does not document a spot demo environment.
- Limits and precision are discovered at runtime rather than copied from examples.

Canonical query ordering, percent encoding, and JSON serialization are tested as part of the signed contract. The client maintains server-time offset, retries only safe operations, backs off after rate limits, and reconciles ambiguous order outcomes by client order ID instead of blind resubmission.

Official sources:

- https://www.weex.com/api-doc/spot/QuickStart/IntegrationPreparation
- https://www.weex.com/api-doc/spot/QuickStart/Signature
- https://www.weex.com/api-doc/spot/QuickStart/AccessRestrictions
- https://www.weex.com/api-doc/spot/MarketDataAPI/GetKLineData
- https://www.weex.com/api-doc/spot/orderApi/PlaceOrder
- https://www.weex.com/api-doc/contract/QuickStart/IntegrationPreparation
- https://www.weex.com/api-doc/contract/QuickStart/Signature
- https://www.weex.com/api-doc/contract/Market_API/GetHistoryKlines
- https://www.weex.com/api-doc/contract/Transaction_API/PlaceOrder
- https://www.weex.com/api-doc/contract/demo/PlaceOrder

WEEX V3 is labelled beta. Adapter inputs and outputs require runtime validation so API changes cannot silently reach trading logic.

## Credential security

The local wizard asks for APIKey, SecretKey, and Passphrase once. It recommends a dedicated key with read and only required trading permissions, forbids withdrawal permission in product policy, recommends an IP allowlist when the agent has stable egress, verifies the account before saving, stores secrets only in the OS vault, never renders them again, redacts authorization material from logs, and provides rotate, revalidate, disconnect, and erase actions.

The website stores only provider, masked key suffix, permission summary, agent ID, verification time, and status. A browser form must not collect SecretKey or Passphrase.

## Strategy and JavaScript isolation

Structured strategy blocks run in trusted TypeScript. User JavaScript remains inert on the website and never runs in the web worker, API route, or trusted order process.

When enabled in the agent, custom JavaScript runs through a pinned QuickJS WebAssembly runtime inside a dedicated worker with no host filesystem, credential, environment, child-process, or network imports; strict execution deadline, memory, output, and restart limits; immutable normalized inputs; a signal-only output schema; and deterministic time/randomness during backtests. Every signal records the script hash.

Sandbox output is only a proposal. The trusted core validates it and applies the full risk engine. Sandbox failure pauses the strategy and records an audit event.

## Backtesting evidence levels

The UI distinguishes:

1. 快速模擬 — deterministic synthetic preview, labelled illustrative.
2. 歷史回測 — public WEEX candles with data source, range, gaps, fees, slippage, funding treatment, and engine version.
3. 模擬運行 — live public market data with paper fills; spot uses CryptoBot Labs paper execution.
4. 實盤績效 — reconciled WEEX orders and fills from the paired agent.

Futures demo is labelled “WEEX 合約 Demo” and is not presented as a spot testnet. Missing data fails the run or is disclosed; it is never silently interpolated.

Historical results record initial capital, fees, slippage, symbol, interval, range, market, leverage, funding, price source, completeness, configuration hash, strategy/script hash, and engine version. Spot history is limited to coverage the V3 API can prove. CSV import or validated cache may be a documented fallback.

## Risk engine and live unlock

Every deployment starts in paper mode. Live mode remains locked until a local credential is verified, required permissions are present, the agent confirms the accepted no-withdrawal permission policy, mandatory risk fields are set, live product metadata validates the order envelope, and the user reviews the account/strategy/risk summary, accepts the risk statement, and types the bot name. If the WEEX account endpoint cannot prove that withdrawal access is absent, the agent blocks live activation and directs the user to create a dedicated key whose permission summary can be verified.

Mandatory limits have no unlimited value:

- allowed symbols;
- maximum order notional;
- maximum position and total exposure;
- maximum simultaneous positions;
- daily realized plus unrealized loss;
- maximum futures leverage;
- maximum slippage;
- minimum signal cooldown;
- maximum consecutive failures.

The agent enforces risk before every order and a website command cannot override it. Operation modes are “每筆下單前需批准” and “在核准的風險範圍內自動下單”. Approval applies only to the displayed risk envelope.

## Orders and emergency stop

Every order receives a deterministic deployment-scoped client order ID. States include proposed, risk-rejected, submitting, acknowledged, partially filled, filled, cancel-pending, cancelled, rejected, unknown, and reconciled.

A submit timeout produces unknown, not an automatic retry. The agent queries by client order ID and reconciles WebSocket events with REST snapshots. Only proven-idempotent operations retry.

Emergency stop has separate actions:

1. immediately block every new order locally;
2. optionally cancel open orders;
3. close positions only through a distinct high-risk action, never by default.

The website can send a signed stop command, and the agent always provides a local stop control.

## Website information architecture

Existing discovery pages remain. New authenticated surfaces:

- /connections: agent downloads, pairing, devices, recommended WEEX connection, masked status, permissions, revalidation, and removal.
- /backtests: jobs, progress, provenance, results, and failure details.
- /runs: paper/demo/live deployments, health, PnL, positions, orders, last signal, start/pause, and emergency stop.
- /activity: signals, risk blocks, orders, fills, cancellations, API errors, key events, configuration changes, and CSV/JSON export.

Workshop stages become strategy, parameters, advanced logic, preview simulation, historical backtest, and run method. Run method offers paper, live, and download. Live is locked until every gate passes.

Leaderboards segment backtest, paper/demo, and live evidence. Simulation values cannot be labelled as live returns.

## Copy system

Required replacements:

- WEEX ONLY becomes WEEX API · 推薦.
- WEEX 專屬 becomes 針對 WEEX API 深度最佳化.
- 只支援 WEEX 交易所 becomes 目前可用的實盤連線為 WEEX API.
- 只為 WEEX 而生 becomes 推薦使用 WEEX API.

Primary journey copy:

> 先檢視回測與風險，再連接交易帳戶；你也可以下載策略套件自行使用。

Risk disclosure:

> 回測結果不代表未來績效。實盤交易需另行連接並啟用，所有交易均可能產生損失。推薦使用 WEEX API 進行連線。

No copy may imply another exchange is supported. The Open Graph image and metadata must remove WEEX ONLY.

## Persistence

D1 stores users, devices and revocations, pairing codes, strategies and immutable versions, backtest jobs/datasets/results, deployments and risk policies, heartbeats and position summaries, orders and fills without signed headers, append-only audit events, command acknowledgements, and nonce replay records. R2 may store large exports. Browser storage remains limited to temporary drafts and UI preferences.

Audit events include UTC time, local display context, actor/device, strategy and configuration versions, script hash, signal reason, risk decision, client and exchange order IDs, status, error class, and correlation ID. They never include credentials, signatures, authorization headers, or full sensitive account payloads.

## Reliability

The system fails closed:

- stale or missing market data pauses new orders;
- excessive clock drift pauses private calls;
- missing risk state blocks live mode;
- credential or permission failures pause affected deployments;
- rate limits stop bursts and trigger bounded backoff;
- unknown order state blocks conflicting orders until reconciliation;
- repeated sandbox, network, or exchange failures trigger a circuit breaker;
- telemetry loss marks the website offline but does not by itself stop a healthy local strategy.

## Testing and verification

Implementation follows TDD. Required automated evidence:

- golden signing vectors for request methods, query ordering, bodies, and time offset;
- runtime schemas and WEEX error mappings;
- secret-redaction and secret-never-serialized checks;
- pairing expiry, atomic use, device signature, nonce, revocation, and ownership tests;
- backtest accounting, gaps, fees, slippage, funding, and reproducibility;
- risk boundary and property tests;
- order idempotency, ambiguous response, reconciliation, and circuit-breaker state machines;
- sandbox capability-denial and resource limits;
- UI tests for paper defaults, live unlock, typed confirmation, emergency stop, evidence labels, and softened WEEX copy;
- mock-WEEX integration tests that cannot reach production hosts;
- website, Windows-agent, and macOS-agent builds.

Manual acceptance covers WEEX futures demo lifecycle, both OS credential vaults, agent restart, website offline behavior, stale data, network loss, emergency stop, accessibility, responsive UX, and installer signing/notarization.

Real-money smoke tests require a dedicated account, minimum permitted order size, explicit authorization, and a pre-approved checklist. They never run automatically.

## Delivery phases and completion

The plan may use independently testable phases, but the requested feature is complete only when the full flow exists:

1. shared WEEX client, public market data, and historical backtest;
2. identity, D1, pairing, and authenticated website surfaces;
3. desktop shell, OS vaults, and device protocol;
4. paper and WEEX futures demo execution with telemetry;
5. live spot/futures risk gates, orders, reconciliation, and emergency stop;
6. Windows/macOS packaging, CI artifacts, signing integration, complete copy migration, PR update, and redeployment.

Signing certificates, a test WEEX credential, and stable egress where IP allowlisting is required are deployment inputs. Their absence may block public signed installers or real-account acceptance, but must not weaken safeguards or cause unverified claims.

## Explicit non-goals

- custody of user funds;
- withdrawal API support;
- cloud storage of SecretKey or Passphrase;
- cloud-hosted 24/7 trading under this architecture;
- arbitrary JavaScript inside the website worker or trusted order process;
- unsupported exchange claims;
- presenting simulations as live performance.
