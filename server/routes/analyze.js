const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const Report = require('../models/Report');
const { analyze } = require('../services/analyzer');

router.use(rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many analyses. Please wait a minute.' } }));

router.post('/', async (req, res, next) => {
  try {
    const { url, strategy, usePsi } = req.body || {};
    const result = await analyze(url, { usePsi: !!usePsi, strategy: strategy === 'desktop' ? 'desktop' : 'mobile' });
    res.status(201).json(await Report.create(result));
  } catch (e) { next(e); }
});

module.exports = router;
