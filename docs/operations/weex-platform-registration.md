# WEEX OAuth platform activation

WEEX has confirmed that CryptoBot Labs can receive OAuth credentials without a registration packet. Do not send any Supabase, Netlify, database, Cloudflare, AWS, or KMS secret.

Prepared production values:

- Platform name: `CryptoBot Labs`
- Broker ID: `WEEX111162`
- Broker UID: maintained in the private WEEX operations record; never place it in an order ID
- Privacy policy: `https://www.cryptobotlabs.app/privacy`
- Terms of service: `https://www.cryptobotlabs.app/terms`
- Callback URL: `https://api.cryptobotlabs.app/oauth/weex/callback`
- Outgoing IP: the reserved executor egress IP from private deployment evidence

All new Spot, Futures, and Futures Demo submissions must send a unique `newClientOrderId` in the form
`b-WEEX111162-<random_string>`. CryptoBot Labs uses a deterministic, URL-safe 22-character hash suffix,
producing exactly 35 characters in total and satisfying WEEX's under-36-character requirement. The executor
and signed desktop Agent fail closed before persistence or dispatch when this Broker attribution is missing or
mismatched. Lookup and cancellation continue accepting legacy `cb_` IDs so orders created before cutover can
still be reconciled safely.

When WEEX issues the OAuth credentials, still record or test:

- Issued `clientId` and client secret delivery channel.
- Whether callback URL or fixed outgoing IP allow-listing is required for this client.
- `scope=create:apikey` permissions for spot and futures trading.
- The created platform API key has read/trade access only and no withdrawal permission.
- Key deletion, relinking, rate limits, incident escalation, and test-account procedure.

Receiving credentials does not itself authorize launch. Store them in AWS Secrets Manager while
`WEEX_AUTH_STAGE=transition`; this keeps OAuth disabled. Move to `dual` only after the above evidence is complete.
Move to `oauth-only` only after the WEEX identity callback has a stable platform-user mapping and existing users
have a tested migration and rollback path.

Secrets must be inserted directly into AWS Secrets Manager, never pasted into an issue, chat, source file, Terraform variable, Netlify public variable, URL, or application log.
