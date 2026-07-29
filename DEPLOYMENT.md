# CryptoBot Labs deployment

- Production provider: Netlify.
- Netlify site: `cryptobot-labs` (`https://cryptobot-labs.netlify.app`).
- Do not publish this website with OpenAI Sites unless the user explicitly changes this preference.
- Build on Netlify with the checked-in `netlify.toml` command, which clears stale
  output, runs the webpack production build, and rejects Node-only trading
  sandbox dependencies in the Edge middleware bundle.
- Keep `.netlify/` local and ignored. Never commit Netlify authentication tokens.
