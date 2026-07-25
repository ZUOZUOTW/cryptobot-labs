# WEEX credential handling

## Invariants

1. In the web onboarding flow, API Key, SecretKey, and Passphrase are submitted only to the authenticated same-origin Netlify route over HTTPS.
2. The Netlify route holds plaintext only in request memory, never logs or persists it, and forwards it once to the configured AWS Executor with a short-lived signed handoff.
3. The AWS Executor verifies the signed credentials, readable account access, account trading status, and Futures hedge mode before AWS KMS envelope encryption. Durable database records never contain plaintext credentials.
4. Browser storage, D1/Postgres public tables, telemetry, command acknowledgements, logs, crash text, and the strategy sandbox never persist or receive credential material.
5. Website connection records contain only a masked suffix, verified permissions, verification time, executor shard, and monotonic version.
6. CryptoBot Labs implements only WEEX Readonly, Spot, and Futures API capabilities and has no withdrawal request path. WEEX `canWithdraw` fields describe the account, not the API key, and must never be treated as API-key scope evidence.

## Lifecycle

- **Create:** Prefer a dedicated WEEX API key with only the required Readonly and Spot/Futures permissions plus the fixed Executor IP allowlist.
- **Store:** The AWS Executor encrypts credentials with AWS KMS envelope encryption before writing ciphertext; only masked metadata is available to the website.
- **Use:** The Executor synchronises time, verifies current permissions and product rules, decrypts only for a private WEEX request, and never returns plaintext to Netlify.
- **Rotate:** Verify and encrypt the replacement before retiring the old key. Connection versions only increase; stale handoffs cannot reactivate older evidence.
- **Erase:** Stop execution first, erase encrypted credential blobs and cached verification, retain only required metadata evidence, then revoke the key in WEEX.
- **Account compromise:** Revoke the WEEX key from a trusted device and rotate the website session.

## Forbidden handling

- Enter credentials only in the dedicated authenticated WEEX connection form—not strategy JavaScript, issues, pull requests, screenshots, terminal transcripts, or support messages.
- The single manual connection route is the only browser API route allowed to accept secret-shaped fields. It must remain same-origin, size-bounded, no-store, no-redirect, non-logging, and persistence-free.
- Never add secret-shaped fields to any other browser route, database migration, telemetry payload, or command outcome.
- Never add withdrawal or asset-transfer endpoints to the WEEX client or its HTTPS allowlist without a new threat-model review and an explicit product decision.
- Never log signed headers, raw account responses, vault plaintext, provider errors containing request headers, or signing/notarisation secrets.
- Never weaken vault or permission checks to make development or acceptance pass.

## Incident response

1. Stop new orders locally if the Agent is reachable.
2. Revoke the WEEX key immediately using WEEX account controls.
3. Revoke the paired device and erase local credentials when possible.
4. Export metadata-only activity evidence and record affected deployment versions/order IDs.
5. Reconcile orders and positions directly in WEEX before creating a replacement key.
6. Rotate any signing or pairing material that may also be exposed.

No recovery or support process should ask a user to transmit SecretKey or Passphrase outside the dedicated connection form.
