// 部署步骤：
// 1. 上传整个 funding-monitor/ 目录到服务器
// 2. cd funding-monitor
// 3. npm install
// 4. 启动方式（二选一）：
//    直接运行：node server.js
//    后台运行：npm install -g pm2 && pm2 start server.js --name funding-monitor
// 5. 如需开机自启：pm2 startup && pm2 save
// 6. 访问：http://你的服务器IP:3000

const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

const SYMBOLS = new Set([
  "XAUUSDT", "XAGUSDT", "TSLAUSDT", "XPTUSDT", "XPDUSDT", "INTCUSDT",
  "HOODUSDT", "MSTRUSDT", "AMZNUSDT", "CRCLUSDT", "COINUSDT", "PLTRUSDT",
  "COPPERUSDT", "EWYUSDT", "EWJUSDT", "PAYPUSDT", "METAUSDT", "NVDAUSDT",
  "GOOGLUSDT", "CLUSDT", "BZUSDT", "NATGASUSDT", "QQQUSDT", "SPYUSDT",
  "AAPLUSDT", "TSMUSDT", "MUUSDT", "SNDKUSDT"
]);

function withTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
}

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/premium", async (req, res) => {
  try {
    const response = await withTimeout("https://fapi.binance.com/fapi/v1/premiumIndex");
    if (!response.ok) {
      throw new Error(`Binance premiumIndex HTTP ${response.status}`);
    }
    const list = await response.json();
    const data = Array.isArray(list) ? list.filter((item) => SYMBOLS.has(item.symbol)) : [];
    res.json({
      success: true,
      data,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error.name === "AbortError" ? "请求 Binance 超时" : error.message
    });
  }
});

app.get("/api/funding-rate/:symbol", async (req, res) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!SYMBOLS.has(symbol)) {
    return res.status(400).json({
      success: false,
      error: "不支持的 symbol"
    });
  }

  try {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=1`;
    const response = await withTimeout(url);
    if (!response.ok) {
      throw new Error(`Binance fundingRate HTTP ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error.name === "AbortError" ? "请求 Binance 超时" : error.message
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log("Server running on port 3000");
});
