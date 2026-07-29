# Contributing

CryptoBot Labs welcomes focused fixes, tests, documentation, translations, and
security improvements. Trading safety and credential isolation take priority
over feature speed.

## Before opening a pull request

1. Create an issue for a large product or protocol change so the boundary is
   agreed before implementation.
2. Use Node.js `>=22.23.1` and install dependencies with `pnpm install`.
3. Keep credentials synthetic. Never paste a real API key, token, database URL,
   private order record, or production infrastructure identifier into source,
   tests, issues, screenshots, or logs.
4. Run:

   ```bash
   pnpm test
   pnpm lint
   pnpm build
   pnpm licenses:check
   ```

5. Keep the pull request small, explain the threat-model impact, and list the
   exact validation performed.

## Project-specific rules

- Do not add withdrawal or asset-transfer endpoints.
- Do not bypass live-trading, permission, broker-attribution, OAuth-stage, or
  credential-vault gates to make a test pass.
- Automated tests must not place real orders.
- New user-facing copy must update all six generated locale catalogues and pass
  the i18n source-coverage tests.
- Supabase schema changes require a timestamped migration and an updated,
  hash-verified production migration baseline.
- Infrastructure examples must use reserved/example identifiers. Concrete
  production resource IDs belong only in the deployment secret manager and
  private operations evidence.
- Public desktop releases must remain signed, checksummed, SBOM-backed, and
  fail closed when signing inputs are absent.

## Contributions and licensing

Only submit work you have the right to license. By submitting a contribution,
you agree that it may be distributed under Apache-2.0.
Third-party code or assets must retain their notices and have a compatible
license.

Do not add or modify CryptoBot Labs logos, mascots, application icons, or other
reserved Brand Assets unless the maintainers have explicitly accepted the
corresponding rights and intended use. Forks must follow `BRAND_ASSETS.md` and
`TRADEMARKS.md`.

Security reports belong in the private process described in
[SECURITY.md](SECURITY.md), not in a pull request or public issue.
