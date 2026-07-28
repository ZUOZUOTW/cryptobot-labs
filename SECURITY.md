# Security policy

CryptoBot Labs handles automated-trading controls and transient exchange
credentials. Please treat possible vulnerabilities as sensitive even when no
credential is included.

## Supported versions

Security fixes target the current `main` branch and the latest published
desktop Agent release. Older commits, unsigned internal-test artifacts, and
unofficial forks are not supported by the project maintainers.

## Report a vulnerability

Use GitHub's **Security → Report a vulnerability** flow for this repository.
Do not open a public issue for a suspected vulnerability.

Include the affected commit or release, component, impact, minimal
reproduction, and any suggested mitigation. Never include a real WEEX API Key,
Secret Key, Passphrase, OAuth token, database URL, session cookie, signing
certificate, private order data, or personal information. Use synthetic data
in every proof of concept.

The maintainers will acknowledge a usable report, assess severity, coordinate
a fix and release, and agree on disclosure timing. Please allow a reasonable
remediation window before publishing details.

## Scope and safe research

In-scope components include the web control plane, OAuth/manual credential
handoff, AWS Executor, desktop Agent, trading sandbox, order attribution,
release/update chain, and infrastructure definitions.

Do not place real-money orders, access another user's account, degrade WEEX or
project infrastructure, perform denial-of-service testing, exfiltrate data, or
retain credentials. Stop testing when unexpected sensitive data appears and
report it through the private channel.

For credential handling and trust boundaries, see
[credential handling](docs/security/credential-handling.md) and the
[live-trading threat model](docs/security/live-trading-threat-model.md).
