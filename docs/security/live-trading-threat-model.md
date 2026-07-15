# Live trading threat model

This model covers the website, signed control plane, desktop Agent, local credential vault, WEEX private API, and release supply chain. The website never receives a WEEX SecretKey or Passphrase. A control-plane acknowledgement proves only that a version-fenced command was durably handled; exchange state still comes from Agent evidence.

## Trust boundaries and assets

- WEEX credentials and plaintext private-request signatures exist only inside the desktop Agent vault callback.
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
| Compromised website | No exchange credentials or direct order endpoint; Agent independently revalidates live unlock | Agent rejects unsafe or stale commands | Pause locally, revoke device/API key, restore trusted deployment | secret-never-serialized and live-unlock tests |
| Telemetry injection | Signed device events, exact schemas, deployment/version/mode fences | Ledger conflict or invalid-event rejection | Discard evidence, re-pair compromised device | device-event and activity repository tests |
| Stale market data | Fresh quote/candle/rules checks before every evaluation | Run pauses with a bounded stale-data reason | Restore feed and explicitly resume | market freshness and run-manager tests |
| Clock drift | Server-time probe and private request window guard | Clock-unsynchronised pause | Resynchronise system clock and revalidate connection | signing clock and runner tests |
| WEEX beta schema change | Strict response schemas and fail-closed unknown fields/statuses | Schema-category error and local pause | Update adapter against current official docs; rerun mock contract tests | WEEX private/public client tests |
| Duplicate order | Deterministic client order ID, durable claim, idempotent coordinator | Identity collision or existing-order reconciliation | Query by client ID; never blindly resubmit | order identity and coordinator tests |
| Unknown submit outcome | POST has zero automatic retries; ambiguous state blocks new orders | `unknown` order and paused run | Reconcile REST/history by client ID before resuming | ambiguous-submit and reconciliation tests |
| Rate limits/network loss | Bounded retry only for safe GET requests; circuit breaker | 429/network/server classification and health evidence | Back off, restore network, reconcile, explicitly resume | retry classifier and circuit-breaker tests |
| Credential rotation | Monotonic encrypted connection version and fresh verification | Stale version/permission rejection | Replace locally, revalidate, erase superseded key | connection version and maintenance tests |
| Lost or stolen laptop | OS-backed vault, restricted files, no cloud secret copy | Missing heartbeat/device activity | Revoke WEEX key and website device immediately | vault, revocation, expiry tests |
| Revoked device | Active-device checks on command poll, telemetry, and ownership | Poll/events rejected; website reports stale evidence | Stop Agent, revoke key, pair replacement | device revocation tests |
| Installer/update compromise | Signed/notarized public release, checksums, SBOM, HTTPS allowlist, Electron fuses | Release verifier and platform signature checks | Withdraw release, disable metadata, ship higher signed version | release workflow/config/verifier tests |
| Emergency failure | Local stop-new-orders is independent of website; cancel and close are separate explicit actions | Health, order, and command outcome telemetry | Stop locally, revoke API key; use WEEX UI if Agent cannot reconcile | emergency control and installer tests |

## Residual risk

Trading can lose all allocated funds through market movement, slippage, liquidation, exchange outage, strategy defects, or credential compromise. Controls reduce execution and custody risk; they do not make a strategy profitable. WEEX Demo omits a documented cancellation endpoint, so CryptoBot Labs uses Demo market orders and explicitly disables Demo cancellation.

## Review trigger

Review this document whenever a private endpoint, permission, sandbox capability, persistence field, device protocol, signing provider, updater origin, or emergency action changes.
