require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json({ limit: "50kb" }));
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/analyze", require("./routes/analyze"));
app.use("/api/reports", require("./routes/reports"));
app.use((err, req, res, next) => {
  if (err.status !== 400 && err.status !== 422) console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/speedscope")
  .then(() =>
    app.listen(process.env.PORT || 5000, () =>
      console.log("SpeedScope API running"),
    ),
  )
  .catch((e) => {
    console.error("Mongo connection failed:", e.message);
    process.exit(1);
  });
