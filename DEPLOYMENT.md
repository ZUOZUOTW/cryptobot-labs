# CryptoBot Labs deployment

- Production provider: Netlify, ZStudio team (`lleefftt`).
- Netlify site: `cryptobot-labs` (`https://cryptobot-labs.netlify.app`).
- Do not publish this website with OpenAI Sites unless the user explicitly changes this preference.
- Build on Netlify with `pnpm exec next build --webpack`; the Netlify Next.js runtime packages SSR and API routes.
- Keep `.netlify/` local and ignored. Never commit Netlify authentication tokens.
