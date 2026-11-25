const router = require('express').Router();
const Report = require('../models/Report');
const { parseUrl } = require('../services/net');

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    res.json(await Report.find({}, { url: 1, host: 1, score: 1, grade: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(limit));
  } catch (e) { next(e); }
});

router.get('/history', async (req, res, next) => {
  try {
    const url = parseUrl(req.query.url).href;
    const rows = await Report.find({ url }, { score: 1, 'metrics.ttfbMs': 1, 'metrics.weightBytes': 1, 'metrics.loadMs': 1, createdAt: 1 })
      .sort({ createdAt: -1 }).limit(20).lean();
    res.json(rows.reverse());
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const r = await Report.findById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    res.json(r);
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try { await Report.findByIdAndDelete(req.params.id); res.json({ ok: true }); } catch (e) { next(e); }
});

module.exports = router;
