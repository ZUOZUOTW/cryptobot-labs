# Live trading threat model

This model covers the website, Netlify credential relay, signed control plane, AWS Executor, KMS credential vault, WEEX private API, and release supply chain. The authenticated manual connection route receives a WEEX SecretKey and Passphrase transiently in request memory, forwards them once to the configured Executor, and never logs or persists them. Exchange state still comes from Executor evidence.

## Trust boundaries and assets

- WEEX credentials exist transiently in the authenticated browser form, the no-store Netlify relay, and the AWS Executor process; durable copies are KMS-encrypted.
- Strategy code is untrusted and may emit signals only from a resource-limited sandbox without network, filesystem, process, or credential access.
- The trusted coordinator owns risk evaluation, order identity, reconciliation, and exchange transport.
- Website records contain user ownership, masked permission evidence, deployment versions, commands, and aggregate telemetry—not exchange secrets.
- Signed installers, update metadata, checksums, and the SBOM are release assets.

## Threat register

| Threat | Prevention | Detection | Recovery | Evidence |
|---|---|---|---|---|
| Stolen website session | Same-origin writes, authenticated ownership checks, device/deployment version fences | Audit log shows actor, device, command, and correlation | Sign out, revoke device, erase local credentials | auth, run-route, repository ownership tests |
| Malicious strategy script | QuickJS isolation; signal-only output; no API, network, file, process, or dynamic import capability | Sandbox timeout/schema audit events | Pause run, remove strategy version, revoke device if needed | sandbox capability and resource-limit tests |
| Forged device request | Device key signature, timestamp window, nonce, capability scope | Signature/nonce rejection and audit ledger conflict | Revoke device and pair a new Agent | device request verifier and pairing tests |
| Replay | Atomic pairing use, nonce uniqueness, monotonic heartbeat sequence, command idempotency | Duplicate nonce, sequence, event, or correlation conflict | Rotate pairing credential; reconcile current deployment | replay, idempotency, monotonic-sequence tests |
| Compromised website | Same-origin credential route, strict CSP/release controls, short-lived signed handoff, fixed Executor origin, no redirects or persistence; Executor independently verifies permissions | Unexpected deployment, handoff, connection, or CSP evidence | Pause Executor, revoke WEEX key and website sessions, restore trusted deployment | credential-relay invariant and live-unlock tests |
| Telemetry injection | Signed device events, exact schemas, deployment/version/mode fences | Ledger conflict or invalid-event rejection | Discard evidence, re-pair compromised device | device-event and activity repository tests |
| Stale market data | Fresh quote/candle/rules checks before every evaluation | Run pauses with a bounded stale-data reason | Restore feed and explicitly resume | market freshness and run-manager tests |
| Clock drift | Server-time probe and private request window guard | Clock-unsynchronised pause | Resynchronise system clock and revalidate connection | signing clock and runner tests |
| WEEX beta schema change | Strict response schemas and fail-closed unknown fields/statuses | Schema-category error and local pause | Update adapter against current official docs; rerun mock contract tests | WEEX private/public client tests |
| Duplicate order | Deterministic client order ID, durable claim, idempotent coordinator | Identity collision or existing-order reconciliation | Query by client ID; never blindly resubmit | order identity and coordinator tests |
| Unknown submit outcome | POST has zero automatic retries; ambiguous state blocks new orders | `unknown` order and paused run | Reconcile REST/history by client ID before resuming | ambiguous-submit and reconciliation tests |
| Rate limits/network loss | Bounded retry only for safe GET requests; circuit breaker | 429/network/server classification and health evidence | Back off, restore network, reconcile, explicitly resume | retry classifier and circuit-breaker tests |
| Credential rotation | Monotonic encrypted connection version and fresh verification | Stale version/permission rejection | Replace locally, revalidate, erase superseded key | connection version and maintenance tests |
| KMS or Executor compromise | Fixed-egress least-privilege host, KMS encryption context, restricted database role, no plaintext logs; WEEX client has no withdrawal or asset-transfer request path | Health, KMS, connection, and order audit anomalies | Disable live execution, revoke WEEX keys, rotate KMS and handoff material | envelope, redaction, permission, and readiness tests |
| Lost or stolen laptop | No durable plaintext credential in the browser; session controls and explicit device revocation | Unexpected session, device, or strategy activity | Revoke website sessions, paired devices, and the WEEX key immediately | auth, revocation, and expiry tests |
| Revoked device | Active-device checks on command poll, telemetry, and ownership | Poll/events rejected; website reports stale evidence | Stop Agent, revoke key, pair replacement | device revocation tests |
| Installer/update compromise | Signed/notarized public release, checksums, SBOM, HTTPS allowlist, Electron fuses | Release verifier and platform signature checks | Withdraw release, disable metadata, ship higher signed version | release workflow/config/verifier tests |
| Emergency failure | Local stop-new-orders is independent of website; cancel and close are separate explicit actions | Health, order, and command outcome telemetry | Stop locally, revoke API key; use WEEX UI if Agent cannot reconcile | emergency control and installer tests |

## Residual risk

Trading can lose all allocated funds through market movement, slippage, liquidation, exchange outage, strategy defects, or credential compromise. Controls reduce execution and custody risk; they do not make a strategy profitable. WEEX account responses expose account-level `canWithdraw`; this is not API-key permission evidence, so custody isolation is enforced by the documented Readonly/Spot/Futures key model and by omitting withdrawal and asset-transfer request paths entirely. WEEX Demo omits a documented cancellation endpoint, so CryptoBot Labs uses Demo market orders and explicitly disables Demo cancellation.

## Review trigger

Review this document whenever a private endpoint, permission, sandbox capability, persistence field, device protocol, signing provider, updater origin, or emergency action changes.
