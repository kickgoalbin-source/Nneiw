GARDA CAD (Cloudflare Worker)
=============================
Admin login: GARDA-1234 / 2245  - change it in Settings straight away.

DEPLOY (one time)
1. Run install.bat (installs Node.js if you do not have it).
2. Run Deploy.bat. A browser opens - log in to Cloudflare and click Allow.
   It prints your address: https://garda-cad.<name>.workers.dev
3. To use your own domain: Cloudflare dashboard > Workers & Pages > garda-cad >
   Settings > Domains & Routes > Add > Custom domain.

UPDATING: change the files, run Deploy.bat again. Data is kept.

Deploying from GitHub instead: connect the repo in Workers & Pages. Build command
none, deploy command "npx wrangler deploy". wrangler.toml does the rest.

DATA is stored in a Cloudflare Durable Object (SQLite), not in a file. It survives
deploys. Test-Local.bat runs a private test copy on this PC (its data is separate).

Health check: /healthz  ->  {"ok":true}
