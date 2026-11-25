// scale(v, good, bad): 100 at or below `good`, 0 at or above `bad`, linear in between
const scale = (v, good, bad) => (v <= good ? 100 : v >= bad ? 0 : Math.round((100 * (bad - v)) / (bad - good)));
const WEIGHTS = { speed: 0.3, weight: 0.2, compression: 0.15, practices: 0.15, requests: 0.1, caching: 0.1 };

function categoryScores(m) {
  return {
    speed: Math.round(scale(m.ttfbMs, 200, 1800) * 0.5 + scale(m.loadMs, 1500, 8000) * 0.5),
    weight: scale(m.weightBytes / 1024, 500, 5000),
    requests: scale(m.requests, 25, 150),
    compression: m.compressibleCount ? Math.round((m.compressedCount / m.compressibleCount) * 100) : 100,
    caching: m.staticCount ? Math.round((m.cachedCount / m.staticCount) * 100) : 100,
    practices: Math.max(0, Math.min(100, 100 - m.penalty)),
  };
}

function overall(categories) {
  return Math.round(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + categories[k] * w, 0));
}

const grade = (s) => (s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 60 ? 'C' : s >= 40 ? 'D' : 'F');

module.exports = { categoryScores, overall, grade, scale };
