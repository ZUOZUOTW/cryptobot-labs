# CryptoBot Labs Final Review Fix Report

Date: 2026-07-10  
Branch: `codex/cryptobot-labs`  
Base reviewed: `79ff0991044e16feaf6e660db821a2fb5b801d89`

## Outcome

All twelve final whole-branch review groups were implemented in the requested worktree. The application remains a WEEX-only, inert simulation prototype: no API-key surface, no real trading path, and no execution of user JavaScript were added.

## RED evidence

Tests were added before each behavior wave and observed failing for the expected missing behavior:

- Core safety/package wave: 13 failures covered canonical blocks, decoded identifier/string checks, unresolved network destinations, export provenance, and structurally safe drafts.
- Workshop/recovery wave: 7 failures covered source removal, import persistence recovery, deliberate blank precedence/reset, localized states, and mobile actions.
- Discovery wave: 3 failures covered timeframe filtering, favorites/preferences persistence, and storage failure; a later malformed-preference test failed after mount until sanitization was added.
- Download wave: 4 failures covered the shared five-file builder, quick-download confirmation, quick fallback, and workshop fallback.
- Detail/copy wave: 3 failures covered deterministic benchmark comparison and the pnpm D1 message.
- Mobile run-state and WebTransport received separate focused RED runs before their implementations.

## GREEN implementation summary

1. Visual mode now deletes `config.source`; JavaScript mode may add the safe template. Toggle/import/backtest/export regressions prove visual packages cannot retain stale source.
2. Static source validation now scans decoded strings and identifiers for known non-WEEX exchanges, folds string `+` and resolvable templates, and applies a WEEX host/scheme allowlist to fetch, WebSocket, EventSource, Request, and WebTransport destinations. Unresolved destinations are rejected; source remains inert.
3. Export uses the same semantic `reportsMatch` comparison as import and rejects reports not produced by deterministic `runBacktest(config)`.
4. `STRATEGY_BLOCKS` is deep-frozen at runtime; duplicate/unknown blocks and parameters, group drift, declared min/max/step drift, and canonical range violations are rejected. All ten bots now receive defensive clones of canonical blocks and round-trip through packages.
5. `validateDraftConfig` separates safe persistence from run readiness, preserving incomplete and invalid-JavaScript drafts. Valid imports survive localStorage failure in memory with a Traditional Chinese backup warning and immediate export readiness.
6. Landing blank CTA uses `/workshop?new=1`; `new=1` outranks bot/draft restoration, and the workshop exposes `建立空白策略` with validation guidance.
7. Catalog adds timeframe filtering, favorites, and safe persisted market/risk/tag/timeframe/sort/favorite preferences. Restoration runs after mount, sanitizes unknown values, and storage failures remain non-fatal.
8. Every package action requires the simulation/cannot-trade confirmation. A shared validated five-file builder plus shared browser download helper provides retry, URL cleanup, and individual-file fallback for quick/detail/workshop flows.
9. Mobile workshop adds a fixed safe-area-aware bottom action bar with unique accessible labels, validation feedback, run-state feedback, real backtest triggering, and export readiness/download triggering.
10. Bot detail adds a deterministic WEEX benchmark series beside bot equity and a textual accessible end-value comparison.
11. Visible backtest states are Traditional Chinese while `data-state` remains `idle|validating|running|complete|error`.
12. Optional D1 recovery copy now says `pnpm run db:generate`.

## Fresh verification

- Focused core: 5 files, 110 tests passed.
- Focused workshop: 1 file, 40 tests passed.
- Focused discovery/UI: 4 files, 75 tests passed.
- Full `pnpm test`: 11 files, 227 tests passed.
- `pnpm run lint`: exit 0, no warnings/errors.
- `pnpm run build`: exit 0; all five vinext environments built and all app routes emitted.
- `node --test tests/rendered-html.test.mjs`: 3 passed, 0 failed.
- `git diff --check`: clean.
- Secret scan: no credentials/secrets; the only `password` occurrence is URL credential rejection logic.
- Execution scan: no eval, Function constructor, script injection, Worker, importScripts, vm, or child-process execution path.
- Non-WEEX scan: exchange names occur only in the intentional validation denylist and tests; no non-WEEX endpoint exists in application runtime code.
- Network scan: application code has no trading request path; worker fetches are limited to the hosting asset/server handler.

## Self-review

- Confirmed exact disclaimer text remains unchanged on performance surfaces.
- Confirmed exactly ten catalog bots and canonical package round-trips.
- Confirmed generated fallback files are the required five names and are validated before exposure.
- Confirmed ZIP and individual downloads remove temporary anchors and schedule object URL revocation even when clicking throws.
- Confirmed visual mode source deletion invalidates any source-associated report fingerprint.
- Confirmed explicit blank flow does not consume saved drafts and remains intentionally non-runnable until required blocks are selected.
- Confirmed preferences render defaults first and restore only after mount, avoiding server/client hydration divergence.
- Confirmed mobile actions do not add duplicate IDs or duplicate business state machines.
- Confirmed build output contains only vinext's informational route-classification notice; no actionable build warning or error remains.

No unresolved implementation concern remains. Deployment/push was not part of this final-fix task.

---

## Final branch re-review follow-up

Date: 2026-07-10

### RED evidence

- Added 20 initially failing regressions covering canonical block/parameter display metadata, JavaScript market/symbol/timeframe drift, mutable/reassigned network bindings, dynamic workshop source generation, normal draft persistence guidance, and quick-download keyboard/tone behavior.
- Added follow-up export/import source-consistency and quick-download success/failure focus assertions before final verification.

### Implemented fixes

1. JavaScript templates are generated from the current market, symbol, and timeframe. Recognized declarations, object properties, and assignments are compared with bot-config; drift blocks backtest and export with Traditional Chinese field/value guidance, including package import/export validation.
2. Static URL resolution now trusts only unique, single-assignment `const` bindings. `let`, `var`, direct assignment, compound assignment, update expressions, and aliases depending on invalidated bindings remain unresolved and are rejected at network call sites.
3. Canonical validation now protects block name/description and parameter label/suffix. Valid imported configs are reconstructed from the runtime catalog while copying only validated parameter values before provenance comparison and return.
4. Quick and workshop downloads share one keyboard-complete confirmation dialog: initial focus, Tab/Shift+Tab trap, Escape/cancel close, and trigger focus restoration after cancellation and deferred success/failure.
5. Ordinary draft-save failures keep the in-memory config and explicitly advise immediate strategy-package backup in Traditional Chinese.
6. Quick-download markup now uses a valid `div` container instead of a `span` around section/dialog content.
7. Download feedback carries separate semantic tones: failures use `role="alert"`/`danger`; successes use `role="status"`/`success`.

### Fresh verification

- Focused validation/package/workshop/discovery: 4 files, 175 tests passed before the final export/import additions.
- Focused final package/discovery: 2 files, 75 tests passed.
- Full `pnpm test`: 11 files, 248 tests passed.
- `pnpm lint`: exit 0.
- `pnpm build`: exit 0; all five vinext environments built and all routes emitted.
- `node --test tests/rendered-html.test.mjs`: 3 passed, 0 failed.
- `git diff --check`: clean.
- Secret and code-execution scans: no findings.
- Runtime non-WEEX scan: only the intentional static-validation denylist matched.
- Runtime network-call scan: no trading request path found.

No unresolved concern remains from the five Important and two Minor re-review findings.

---

## Final deployment-gate closure

Date: 2026-07-11

### RED / GREEN evidence

- RED: 3 expected failures proved source metadata was last-write-wins and draft-save warnings exposed no independent backup action.
- GREEN focused validation/workshop/package: 3 files, 158 tests passed.
- Source validation now retains every distinct static market, symbol, and timeframe value; either declaration order rejects the mismatched value.
- Every structurally safe in-memory config exposes a connected-anchor JSON draft backup after persistence failure, including invalid/incomplete edits and reset-to-blank. Copy and filenames identify it as a non-executable draft backup; object URLs and anchors are cleaned up.

### Fresh verification

- Full `pnpm test`: 11 files, 252 tests passed.
- `pnpm run lint`: exit 0.
- `pnpm run build`: exit 0; all five vinext environments built.
- `git diff --check`: clean.
- Security scan: no execution sink, embedded credential, or trading request path; matches were limited to hosting asset fetches and URL-credential rejection checks.
