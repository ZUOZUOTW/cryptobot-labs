# Production browser acceptance tests

The browser suite is a release gate for signed-out and public product flows. It runs the compiled Next.js application rather than the development server and never connects to Supabase Auth or WEEX.

## Coverage

- Desktop Chromium at 1440 × 900.
- Mobile Chromium at 320 × 800 and 390 × 844 with touch enabled.
- Mobile WebKit at 390 × 844.
- Public route availability and root horizontal-overflow checks.
- English locale bootstrap, including the default JavaScript workshop source.
- JavaScript workshop sign-in return-path recovery through the local demo identity only.
- Keyboard skip-link and share-dialog focus recovery.
- WCAG 2.0/2.1 A/AA axe checks on the public home and share dialog.
- Dynamic social poster response type, PNG signature, byte bounds, and 1200 × 630 dimensions.
- Trusted native Chromium touch input for the workshop swipe gesture.

The WebKit project is browser emulation, not evidence from physical iOS hardware. A device-farm or manual release check remains required when physical-device acceptance is part of a release.

## Local use

Install the pinned browser engines once:

```sh
pnpm exec playwright install chromium webkit
```

Run the full production suite:

```sh
pnpm test:e2e
```

Run one project while iterating:

```sh
pnpm test:e2e -- --project=mobile-chromium-320
```

When an up-to-date `.next` production build already exists, skip only the rebuild:

```sh
E2E_SKIP_BUILD=true pnpm test:e2e -- --project=desktop-chromium
```

The runner chooses separate available loopback ports for the compiled Next.js server and a test-only HTTP proxy. The proxy removes only the `upgrade-insecure-requests` CSP directive, because WebKit otherwise upgrades loopback assets to HTTPS and cannot load an HTTP test server; production header policy remains covered by the security-header unit tests. The build uses `DEMO_MODE=true`, `LIVE_TRADING_ENABLED=false`, and the reserved HTTPS origin `https://e2e.cryptobot.invalid`; the started server receives the proxy's exact loopback `PUBLIC_ORIGIN` so poster rendering can fetch only same-origin assets. Credential-shaped Supabase, WEEX, executor, AWS, and auth-cookie environment variables are removed from both child processes.

Browser requests to non-loopback origins are blocked. The WEEX market catalogue is deliberately replaced with its unavailable response so the product's built-in fallback is exercised without external traffic. Community publications are an empty public fixture; repository and API authorization remain covered by Vitest/Postgres suites.

On failure, inspect `playwright-report/` and `test-results/`. Trace, screenshot, and video artifacts are retained only for failed attempts.
