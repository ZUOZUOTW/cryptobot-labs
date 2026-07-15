# WEEX credential handling

## Invariants

1. API Key, SecretKey, and Passphrase are entered only in the desktop Agent.
2. Plaintext credentials exist only during an OS-vault callback that constructs one private WEEX client.
3. The website, browser requests, D1 schema, telemetry, command acknowledgements, logs, crash text, and strategy sandbox never receive secrets.
4. Website connection records contain only a masked suffix, verified permissions, local-credential presence, verification time, and monotonic version.
5. Withdrawal permission must be absent for live trading. CryptoBot Labs never requests or uses withdrawal APIs.

## Lifecycle

- **Create:** Prefer a dedicated WEEX API key with only required read/trade permission, no withdrawal, and an IP allowlist where stable egress permits it.
- **Store:** The Agent requires OS-backed asynchronous encryption and writes encrypted vault files atomically with owner-only permissions.
- **Use:** The Agent synchronises time, verifies current permissions and product rules, signs the exact transmitted request, and wipes temporary byte copies where supported.
- **Rotate:** Save and verify the replacement before retiring the old key. Connection versions only increase; stale website commands cannot reactivate older evidence.
- **Erase:** Stop execution first, erase the encrypted vault, revoke cached verification, emit metadata-only erasure evidence, then revoke the key in WEEX.
- **Device loss:** Revoke the WEEX key and paired device from a trusted machine. Do not wait for the lost Agent to reconnect.

## Forbidden handling

- Never paste credentials into the website, strategy JavaScript, issue, pull request, test fixture, screenshot, terminal transcript, or support message.
- Never add secret-shaped fields to browser API routes, D1 migrations, telemetry payloads, or command outcomes.
- Never log signed headers, raw account responses, vault plaintext, provider errors containing request headers, or signing/notarisation secrets.
- Never weaken vault or permission checks to make development or acceptance pass.

## Incident response

1. Stop new orders locally if the Agent is reachable.
2. Revoke the WEEX key immediately using WEEX account controls.
3. Revoke the paired device and erase local credentials when possible.
4. Export metadata-only activity evidence and record affected deployment versions/order IDs.
5. Reconcile orders and positions directly in WEEX before creating a replacement key.
6. Rotate any signing or pairing material that may also be exposed.

No recovery process should ask a user to transmit SecretKey or Passphrase to CryptoBot Labs.
