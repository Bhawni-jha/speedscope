const dns = require('dns').promises;
const net = require('net');

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:');
}

function parseUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw Object.assign(new Error('Please enter a URL'), { status: 400 });
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch { throw Object.assign(new Error('That does not look like a valid URL'), { status: 400 }); }
  if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('Only http and https URLs are allowed'), { status: 400 });
  if (u.username || u.password) throw Object.assign(new Error('URLs with credentials are not allowed'), { status: 400 });
  u.hash = '';
  return u;
}

async function assertPublic(u) {
  if (process.env.ALLOW_PRIVATE === '1') return;
  if (!ALLOWED_PORTS.has(u.port)) throw Object.assign(new Error('Port not allowed'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => {
    throw Object.assign(new Error(`Could not resolve ${host}`), { status: 422 });
  });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error('That address is private or not allowed'), { status: 400 });
  }
}

// Fetches one URL (following up to 5 redirects, re-checking each hop) and measures timing and size.
async function fetchResource(url, { wantText = false, maxBytes = 3_000_000, timeoutMs = 10000, maxRedirects = 5 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    let u = typeof url === 'string' ? parseUrl(url) : url;
    const hops = [];
    let res;
    for (let i = 0; i <= maxRedirects; i++) {
      await assertPublic(u);
      res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'SpeedScopeBot/1.0 (+performance analyzer)', accept: '*/*' } });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        hops.push({ url: u.href, status: res.status });
        await res.body?.cancel();
        u = new URL(loc, u);
        if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('Redirected to an unsupported protocol'), { status: 422 });
        if (i === maxRedirects) throw Object.assign(new Error('Too many redirects'), { status: 422 });
        continue;
      }
      break;
    }
    const ttfbMs = performance.now() - t0;
    const chunks = [];
    let bytes = 0, truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (wantText) chunks.push(value);
        if (bytes >= maxBytes) { truncated = true; await reader.cancel(); break; }
      }
    }
    return {
      finalUrl: u.href, status: res.status, headers: Object.fromEntries(res.headers), hops,
      ttfbMs: Math.round(ttfbMs), totalMs: Math.round(performance.now() - t0), bytes, truncated,
      text: wantText ? Buffer.concat(chunks).toString('utf8') : undefined,
    };
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('The site took too long to respond'), { status: 422 });
    if (e.status) throw e;
    throw Object.assign(new Error(`Could not fetch the site: ${e.cause?.code || e.message}`), { status: 422 });
  } finally { clearTimeout(timer); }
}

module.exports = { fetchResource, parseUrl, isPrivateIp };
