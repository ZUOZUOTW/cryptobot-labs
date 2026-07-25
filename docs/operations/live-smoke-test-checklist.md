# Live execution smoke-test checklist

This checklist is manual. Automated tests and ordinary development must never place a real-money order.

## Required authorisation

- [ ] A named owner explicitly authorises this exact run, account, symbol, side, maximum loss, and time window.
- [ ] A dedicated WEEX account and new API key are used; withdrawal is disabled and an IP allowlist is enabled where possible.
- [ ] The account holds only the approved test amount.
- [ ] Current WEEX product rules and minimum order size were retrieved immediately before the test.
- [ ] A second person reviews the stop, revoke, and reconciliation procedure.

If any item above is false, stop after Paper and WEEX Demo acceptance.

## Paper and Demo prerequisites

- [ ] Pair one macOS Agent and one Windows Agent; verify encrypted persistence, restart, start-at-login opt-in, rotation, and erase.
- [ ] Complete a Paper spot lifecycle and confirm it is labelled CryptoBot Labs simulation—not WEEX Demo.
- [ ] Complete a WEEX futures Demo open/reconcile/close lifecycle using market orders.
- [ ] Confirm Demo cancellation is visibly unavailable because WEEX does not document that endpoint.
- [ ] Confirm website offline, telemetry retry, stale market, time drift, network loss, and Agent restart all fail closed without duplicate orders.
- [ ] Verify local stop-new-orders works without website connectivity; cancel and close remain independent actions.

## Minimum live smoke test

- [ ] Revalidate read/trade permission, absent withdrawal permission, hedge mode for futures, clock, market data, and product rules.
- [ ] Use one symbol, the minimum permitted quantity, conservative leverage, and a risk policy below the approved maximum loss.
- [ ] Record deployment version, strategy version, configuration hash, client order ID, and operator timestamp before submitting.
- [ ] Submit exactly one explicitly authorised order. Do not automatically retry an unknown result.
- [ ] Reconcile acknowledgement, fills, fees, position, and website evidence against WEEX.
- [ ] Stop new orders, close the test position if required, verify flat/open-order state directly in WEEX, then pause the run.
- [ ] Revoke or rotate the test key and confirm the Agent/website report erasure or the new connection version.

## Abort conditions

Abort immediately on unknown order state, schema drift, stale data, clock error, permission change, withdrawal capability, rate limit, network uncertainty, unexpected position, signature failure, or inability to stop locally. Use the WEEX interface to secure the account and reconcile state before any retry.

## Acceptance record

Record tester names, OS/Agent versions, release digest, deployment/version IDs, WEEX environment, approved loss, timestamps, observed results, deviations, and incident links. Never record API Key, SecretKey, Passphrase, signed headers, or raw credentials.
