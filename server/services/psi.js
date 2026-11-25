// Optional: real Lighthouse data (Core Web Vitals) from Google PageSpeed Insights
async function runPsi(url, strategy = 'mobile') {
  const params = new URLSearchParams({ url, strategy, category: 'performance' });
  if (process.env.PSI_API_KEY) params.set('key', process.env.PSI_API_KEY);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 70000);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: ctrl.signal });
    const data = await res.json();
    if (!res.ok) return { error: data.error?.message || `PageSpeed API error ${res.status}` };
    const a = data.lighthouseResult.audits;
    const num = (id) => (a[id] && a[id].numericValue != null ? Math.round(a[id].numericValue * 100) / 100 : null);
    return {
      strategy,
      score: Math.round((data.lighthouseResult.categories.performance.score || 0) * 100),
      fcp: num('first-contentful-paint'), lcp: num('largest-contentful-paint'),
      tbt: num('total-blocking-time'), cls: num('cumulative-layout-shift'), si: num('speed-index'),
    };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'PageSpeed check timed out' : e.message };
  } finally { clearTimeout(timer); }
}

module.exports = { runPsi };
