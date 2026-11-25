const mongoose = require('mongoose');

const ResourceSchema = new mongoose.Schema(
  { url: String, type: String, status: Number, bytes: Number, transfer: Number, ms: Number, compressed: Boolean, cached: Boolean, thirdParty: Boolean, error: String },
  { _id: false }
);

const ReportSchema = new mongoose.Schema(
  {
    url: { type: String, index: true },        // normalized input URL
    finalUrl: String,
    host: { type: String, index: true },
    score: Number,
    grade: String,
    categories: { speed: Number, weight: Number, requests: Number, compression: Number, caching: Number, practices: Number },
    metrics: {
      ttfbMs: Number, pageMs: Number, loadMs: Number, htmlBytes: Number,
      weightBytes: Number, requests: Number, failed: Number, redirects: Number,
      domNodes: Number, thirdParty: Number, https: Boolean, byType: mongoose.Schema.Types.Mixed,
    },
    findings: [{ id: String, severity: String, title: String, detail: String, _id: false }],
    resources: [ResourceSchema],
    psi: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Report', ReportSchema);
