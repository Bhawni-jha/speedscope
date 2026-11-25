const cheerio = require('cheerio');
const { fetchResource, parseUrl } = require('./net');
const { categoryScores, overall, grade } = require('./score');
const { runPsi } = require('./psi');

const COMPRESSIBLE = /(text\/|javascript|json|xml|svg)/i;
const COMPRESSED = new Set(['gzip', 'br', 'deflate', 'zstd']);
const MAX_RESOURCES = 30, CONCURRENCY = 6;
const kb = (n) => Math.round(n / 1024);

function typeOf(tag, url, ct = '') {
  if (tag) return tag;
  if (/css/.test(ct)) return 'css';
  if (/javascript/.test(ct)) return 'js';
  if (/image/.test(ct)) return 'img';
  if (/font/.test(ct)) return 'font';
  return 'other';
}
function isCached(h) {
  const cc = (h['cache-control'] || '').toLowerCase();
  if (/no-store|no-cache/.test(cc)) return false;
  const m = cc.match(/(?:s-)?max-age=(\d+)/);
  if (m && +m[1] >= 86400) return true;
  if (/immutable/.test(cc)) return true;
  const exp = Date.parse(h.expires || '');
  return !Number.isNaN(exp) && exp - Date.now() >= 86400000;
}
async function pool(items, worker, limit) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await worker(items[n]); }
  }));
  return out;
}

async function analyze(input, { usePsi = false, strategy = 'mobile' } = {}) {
  const inputUrl = parseUrl(input).href;
  const psiPromise = usePsi ? runPsi(inputUrl, strategy) : Promise.resolve(null);

  const page = await fetchResource(inputUrl, { wantText: true, maxBytes: 3_000_000, timeoutMs: 15000 });
  if (page.status >= 400) throw Object.assign(new Error(`The site returned HTTP ${page.status}`), { status: 422 });
  const base = new URL(page.finalUrl);
  const $ = cheerio.load(page.text || '');

  // ---- collect assets referenced by the page ----
  const found = new Map();
  const add = (src, type) => {
    if (!src || /^(data:|blob:|javascript:|#)/i.test(src)) return;
    try { const u = new URL(src, base); u.hash = ''; if (!found.has(u.href)) found.set(u.href, type); } catch { /* ignore bad url */ }
  };
  $('link[rel~="stylesheet"]').each((_, e) => add($(e).attr('href'), 'css'));
  $('script[src]').each((_, e) => add($(e).attr('src'), 'js'));
  $('link[rel~="preload"][as="font"]').each((_, e) => add($(e).attr('href'), 'font'));
  $('img').each((_, e) => add($(e).attr('src') || $(e).attr('data-src'), 'img'));
  const list = [...found.entries()].slice(0, MAX_RESOURCES);
  const totalFound = found.size;

  // ---- fetch assets (limited concurrency) ----
  const tRes = performance.now();
  const resources = await pool(list, async ([url, tag]) => {
    const third = new URL(url).hostname !== base.hostname;
    try {
      const r = await fetchResource(url, { maxBytes: 3_000_000, timeoutMs: 8000 });
      const enc = (r.headers['content-encoding'] || '').toLowerCase();
      const compressed = COMPRESSED.has(enc);
      const cl = parseInt(r.headers['content-length'] || '', 10);
      const type = typeOf(tag, url, r.headers['content-type']);
      return { url, type, status: r.status, bytes: r.bytes, transfer: compressed && cl ? cl : r.bytes, ms: r.totalMs, compressed,
        cached: isCached(r.headers), thirdParty: third, ct: r.headers['content-type'] || '' };
    } catch (e) { return { url, type: tag, status: 0, bytes: 0, transfer: 0, ms: 0, compressed: false, cached: false, thirdParty: third, error: e.message, ct: '' }; }
  }, CONCURRENCY);
  const resMs = Math.round(performance.now() - tRes);

  // ---- page-level facts ----
  const pageEnc = (page.headers['content-encoding'] || '').toLowerCase();
  const pageCompressed = COMPRESSED.has(pageEnc);
  const pageCl = parseInt(page.headers['content-length'] || '', 10);
  const htmlTransfer = pageCompressed && pageCl ? pageCl : page.bytes;
  const ok = resources.filter((r) => !r.error && r.status < 400);
  const failed = resources.length - ok.length;
  const byType = { html: htmlTransfer };
  ok.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + r.transfer; });
  const weightBytes = Object.values(byType).reduce((a, b) => a + b, 0);

  const compressible = [{ compressed: pageCompressed }, ...ok.filter((r) => COMPRESSIBLE.test(r.ct) || ['css', 'js'].includes(r.type)).filter((r) => r.bytes > 1024)];
  const statics = ok.filter((r) => ['css', 'js', 'img', 'font'].includes(r.type));

  // ---- best practice checks ----
  const findings = [];
  let penalty = 0;
  const add2 = (id, severity, title, detail, p = 0) => { findings.push({ id, severity, title, detail }); penalty += p; };

  const blocking = $('head script[src]').filter((_, e) => { const s = $(e); return !s.attr('async') && !s.attr('defer') && s.attr('type') !== 'module'; }).length;
  if (blocking) add2('blocking-js', 'high', `${blocking} render-blocking script${blocking > 1 ? 's' : ''} in <head>`, 'Add defer or async, or move scripts to the end of <body>, so the page can paint before JavaScript loads.', Math.min(25, blocking * 8));
  const cssCount = $('link[rel~="stylesheet"]').length;
  if (cssCount > 4) add2('many-css', 'medium', `${cssCount} separate stylesheets`, 'Combine and minify CSS, and inline the small critical part to reduce blocking requests.', 5);

  const imgs = $('img');
  const noAlt = imgs.filter((_, e) => $(e).attr('alt') === undefined).length;
  const noSize = imgs.filter((_, e) => !($(e).attr('width') && $(e).attr('height'))).length;
  const notLazy = imgs.filter((i, e) => i >= 2 && $(e).attr('loading') !== 'lazy').length;
  if (noSize) add2('img-size', 'medium', `${noSize} image${noSize > 1 ? 's' : ''} without width and height`, 'Set width and height so the browser reserves space and the layout does not jump (CLS).', Math.min(10, noSize));
  if (notLazy > 2) add2('img-lazy', 'medium', `${notLazy} images are not lazy-loaded`, 'Add loading="lazy" to images below the fold so they do not compete with critical resources.', 8);
  if (noAlt) add2('img-alt', 'low', `${noAlt} image${noAlt > 1 ? 's' : ''} missing alt text`, 'Alt text helps accessibility and SEO.', 3);
  const bigImgs = ok.filter((r) => r.type === 'img' && r.bytes > 200 * 1024);
  if (bigImgs.length) add2('img-big', 'high', `${bigImgs.length} image${bigImgs.length > 1 ? 's' : ''} over 200 KB`, `Largest is ${kb(Math.max(...bigImgs.map((r) => r.bytes)))} KB. Resize to display size and compress.`, 10);
  const oldFmt = ok.filter((r) => r.type === 'img' && /(jpeg|png|gif)/i.test(r.ct) && r.bytes > 30 * 1024);
  if (oldFmt.length) add2('img-format', 'medium', `${oldFmt.length} image${oldFmt.length > 1 ? 's' : ''} could use WebP or AVIF`, 'Modern formats are usually 25-50% smaller at the same quality.', 5);

  if (!$('meta[name="viewport"]').length) add2('viewport', 'high', 'Missing viewport meta tag', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for correct mobile rendering.', 10);
  const domNodes = $('*').length;
  if (domNodes > 1500) add2('dom', 'medium', `Large DOM (${domNodes} elements)`, 'Big DOMs slow style calculation and layout. Simplify markup or render long lists lazily.', 5);
  if (page.bytes > 100 * 1024) add2('html-size', 'low', `HTML is ${kb(page.bytes)} KB`, 'Large HTML delays parsing. Move inline data and scripts to cacheable files.', 3);

  const https = base.protocol === 'https:';
  if (!https) add2('https', 'high', 'Site is not served over HTTPS', 'HTTPS is required for HTTP/2, security and modern browser features.', 15);
  else if (!page.headers['strict-transport-security']) add2('hsts', 'low', 'No HSTS header', 'Add Strict-Transport-Security to avoid an extra redirect from http to https on repeat visits.', 2);
  if (page.hops.length >= 2) add2('redirects', 'medium', `${page.hops.length} redirects before the page loads`, 'Each redirect adds a full round trip. Link directly to the final URL.', 5);

  const thirdParty = ok.filter((r) => r.thirdParty).length;
  if (thirdParty > 8) add2('third-party', 'medium', `${thirdParty} third-party requests`, 'Audit analytics, widgets and fonts. Remove or delay what you do not need.', 5);

  // ---- speed / size / compression / caching findings ----
  if (page.ttfbMs > 800) findings.push({ id: 'ttfb', severity: page.ttfbMs > 1800 ? 'high' : 'medium', title: `Slow server response (${page.ttfbMs} ms)`, detail: 'Use caching, a CDN, a faster host, or optimise database queries. Aim for under 200-600 ms.' });
  if (!pageCompressed && page.bytes > 1024) findings.push({ id: 'html-gzip', severity: 'high', title: 'HTML is not compressed', detail: 'Enable gzip or Brotli on your server or CDN. It usually cuts text size by 70% or more.' });
  const uncompressed = ok.filter((r) => ['css', 'js'].includes(r.type) && r.bytes > 1024 && !r.compressed);
  if (uncompressed.length) findings.push({ id: 'asset-gzip', severity: 'high', title: `${uncompressed.length} CSS/JS file${uncompressed.length > 1 ? 's' : ''} not compressed`, detail: `Potential saving about ${kb(uncompressed.reduce((a, r) => a + r.bytes * 0.7, 0))} KB. Turn on gzip or Brotli for these types.` });
  const uncached = statics.filter((r) => !r.cached);
  if (statics.length && uncached.length / statics.length > 0.3) findings.push({ id: 'caching', severity: 'medium', title: `${uncached.length} of ${statics.length} static files lack long-term caching`, detail: 'Set Cache-Control: public, max-age=31536000, immutable on versioned assets so repeat visits are instant.' });
  if (weightBytes > 3 * 1024 * 1024) findings.push({ id: 'weight', severity: 'high', title: `Page weight is ${(weightBytes / 1048576).toFixed(1)} MB`, detail: 'Compress images, remove unused JavaScript and avoid heavy libraries. Aim for under 1.5 MB.' });
  if (failed) findings.push({ id: 'failed', severity: 'medium', title: `${failed} asset${failed > 1 ? 's' : ''} failed to load`, detail: 'Broken links waste requests. Fix or remove them.' });
  if (totalFound > MAX_RESOURCES) findings.push({ id: 'limit', severity: 'low', title: `Only the first ${MAX_RESOURCES} of ${totalFound} assets were measured`, detail: 'Weight and request totals are therefore a lower bound.' });
  if (!findings.length) findings.push({ id: 'ok', severity: 'low', title: 'No major issues found', detail: 'Nice work. Keep monitoring after each deploy.' });
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  // ---- scores ----
  const loadMs = page.totalMs + resMs;
  const m = {
    ttfbMs: page.ttfbMs, loadMs, weightBytes, requests: 1 + ok.length,
    compressibleCount: compressible.length, compressedCount: compressible.filter((r) => r.compressed).length,
    staticCount: statics.length, cachedCount: statics.filter((r) => r.cached).length, penalty,
  };
  const categories = categoryScores(m);
  const score = overall(categories);

  const slim = ({ ct, ...r }) => r;
  return {
    url: inputUrl, finalUrl: page.finalUrl, host: base.hostname, score, grade: grade(score), categories,
    metrics: { ttfbMs: page.ttfbMs, pageMs: page.totalMs, loadMs, htmlBytes: page.bytes, weightBytes, requests: m.requests, failed,
      redirects: page.hops.length, domNodes, thirdParty, https, byType },
    findings, resources: resources.map(slim), psi: await psiPromise,
  };
}

module.exports = { analyze };
