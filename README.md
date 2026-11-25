# SpeedScope – Website Performance Analyzer (MERN)

Enter a URL and get a 0-100 performance score, key metrics, a resource breakdown, specific fixes, and a history trend for that site.

## Setup
Node 18+ and MongoDB (local or Atlas).
```bash
cd server && cp .env.example .env && npm install && npm run dev   # http://localhost:5000
cd client && npm install && npm run dev                            # http://localhost:5173
```

## What it measures (server-side, no browser needed)
| Area | How |
|---|---|
| TTFB, load time | Time to first byte (incl. redirects) and total fetch time of the page and its assets |
| Page weight, requests | HTML plus up to 30 CSS / JS / image / font files found in the page |
| Compression | gzip / br on HTML, CSS, JS, JSON, SVG |
| Caching | `Cache-Control` max-age >= 1 day, `immutable` or `Expires` on static assets |
| Best practices | render-blocking scripts, image alt / size / lazy-loading / format, viewport meta, HTTPS + HSTS, DOM size, third-party count |
| Core Web Vitals (optional) | Google PageSpeed Insights (real Lighthouse): LCP, FCP, TBT, CLS, Speed Index. Tick the checkbox in the UI. Add `PSI_API_KEY` in `.env` for higher quota |

Score weights: speed 30%, weight 20%, compression 15%, best practices 15%, requests 10%, caching 10% (see `services/score.js`).

## API
- `POST /api/analyze` `{ "url": "https://example.com", "strategy": "mobile", "usePsi": false }`
- `GET  /api/reports?limit=10` · `GET /api/reports/history?url=...` · `GET/DELETE /api/reports/:id`

## Important notes
- **SSRF protection:** the server fetches URLs you give it, so `services/net.js` blocks localhost, private and link-local IPs (also after redirects), limits ports to 80/443/8080/8443, and `/api/analyze` is rate-limited (10 per minute). DNS rebinding is not fully covered, so do not expose this to the public internet without an egress firewall. For local testing only, set `ALLOW_PRIVATE=1` in `.env`.
- It does not run JavaScript, so it cannot measure rendering metrics (LCP, CLS). That is why the optional PageSpeed Insights check exists.
- Results depend on where the server runs, as TTFB is measured from your server's network.
