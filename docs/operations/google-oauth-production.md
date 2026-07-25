# Google OAuth production setup

Production website: `https://www.cryptobotlabs.app`

Google Cloud OAuth client:

- Application type: Web application
- Authorized JavaScript origin: `https://www.cryptobotlabs.app`
- Authorized redirect URI: `https://howimusddmvxqbfvncqr.supabase.co/auth/v1/callback`
- Scopes: `openid`, `email`, `profile`

Supabase Auth:

- Site URL: `https://www.cryptobotlabs.app`
- Redirect allow-list: `https://www.cryptobotlabs.app/auth/callback`
- Enable Google provider only after entering the Google Client ID and Client Secret in the Supabase dashboard.

Keep `https://cryptobot-labs.netlify.app/auth/callback` allow-listed during the migration window. Change `PUBLIC_ORIGIN` only after the custom domain certificate is active, then remove unused preview redirects after production verification.

Verification: use a non-admin account, confirm PKCE callback success, sign out, revoke the Google grant, and confirm that a stale callback/state cannot be replayed.
