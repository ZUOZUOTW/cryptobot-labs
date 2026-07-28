# WEEX OAuth platform activation

WEEX has confirmed that CryptoBot Labs can receive OAuth credentials without a registration packet. Do not send any Supabase, Netlify, database, Cloudflare, AWS, or KMS secret.

Prepared production values:

- Platform name: `CryptoBot Labs`
- Broker ID: `WEEX111162`
- Broker UID: `5459424221` (operations metadata only; never place it in an order ID)
- Privacy policy: `https://www.cryptobotlabs.app/privacy`
- Terms of service: `https://www.cryptobotlabs.app/terms`
- Callback URL: `https://api.cryptobotlabs.app/oauth/weex/callback`
- Outgoing IP: `35.73.141.178` (observed from the executor and reserved by Elastic IP)

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

Secrets must be inserted directly into AWS Secrets Manager, never pasted into an issue, chat, source file, Terraform variable, Netlify public variable, URL, or application log.
