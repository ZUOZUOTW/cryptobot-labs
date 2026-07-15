# WEEX OAuth platform activation

WEEX has confirmed that CryptoBot Labs can receive OAuth credentials without a registration packet. Do not send any Supabase, Netlify, database, Cloudflare, AWS, or KMS secret.

Prepared production values:

- Platform name: `CryptoBot Labs`
- Privacy policy: `https://www.cryptobotlabs.app/privacy`
- Terms of service: `https://www.cryptobotlabs.app/terms`
- Callback URL: `https://api.cryptobotlabs.app/oauth/weex/callback`
- Outgoing IP: `35.73.141.178` (observed from the executor and reserved by Elastic IP)

When WEEX issues the OAuth credentials, still record or test:

- Issued `clientId` and client secret delivery channel.
- Whether callback URL or fixed outgoing IP allow-listing is required for this client.
- `scope=create:apikey` permissions for spot and futures trading.
- The created platform API key has read/trade access only and no withdrawal permission.
- Key deletion, relinking, rate limits, incident escalation, and test-account procedure.

Secrets must be inserted directly into AWS Secrets Manager, never pasted into an issue, chat, source file, Terraform variable, Netlify public variable, URL, or application log.
