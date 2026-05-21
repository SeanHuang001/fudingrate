// 部署步骤：
// 1. 上传整个 funding-monitor/ 目录到服务器
// 2. cd funding-monitor
// 3. npm install
// 4. 启动方式（二选一）：
//    直接运行：node server.js
//    后台运行：npm install -g pm2 && pm2 start server.js --name funding-monitor
// 5. 如需开机自启：pm2 startup && pm2 save
// 6. 访问：http://你的服务器IP:3000
// 7. 邮件：Gmail 应用专用密码配置在下方 EMAIL_CONFIG（非登录密码）

const nodemailer = require("nodemailer");
const express = require("express");
const path = require("path");

const EMAIL_CONFIG = {
  from: "songenhuang28@gmail.com",
  to: ["3020867039@qq.com", "ting_hoo@hotmail.com"],
  gmailUser: "songenhuang28@gmail.com",
  gmailAppPassword: "enbq hvbk lgpj ahhj"
};

// ============== BBG 行情模块 ==============

const BBG_BASE_URL = "http://localhost:8000";  // 通过 SSH 反向隧道连接 BBG 服务
const BBG_REFRESH_MS = 5 * 60 * 1000;          // 5 分钟
const BBG_REQUEST_TIMEOUT_MS = 8000;           // 单次请求超时
const BBG_STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000;  // 72 小时，覆盖整个周末

// Binance 合约 → BBG ticker 映射
const BBG_SYMBOL_MAP = {
  "XAUUSDT":    "XAU Curncy",
  "XAGUSDT":    "XAG Curncy",
  "XPTUSDT":    "XPT Curncy",
  "XPDUSDT":    "XPD Curncy",
  "COPPERUSDT": "HG1 Comdty",
  "CLUSDT":     "CL1 Comdty",
  "BZUSDT":     "CO1 Comdty",
  "NATGASUSDT": "NG1 Comdty",
  "TSLAUSDT":   "TSLA US Equity",
  "INTCUSDT":   "INTC US Equity",
  "HOODUSDT":   "HOOD US Equity",
  "MSTRUSDT":   "MSTR US Equity",
  "AMZNUSDT":   "AMZN US Equity",
  "CRCLUSDT":   "CRCL US Equity",
  "COINUSDT":   "COIN US Equity",
  "PLTRUSDT":   "PLTR US Equity",
  "EWYUSDT":    "EWY US Equity",
  "EWJUSDT":    "EWJ US Equity",
  "PAYPUSDT":   "PYPL US Equity",
  "METAUSDT":   "META US Equity",
  "NVDAUSDT":   "NVDA US Equity",
  "GOOGLUSDT":  "GOOGL US Equity",
  "QQQUSDT":    "QQQ US Equity",
  "SPYUSDT":    "SPY US Equity",
  "AAPLUSDT":   "AAPL US Equity",
  "TSMUSDT":    "TSM US Equity",
  "MUUSDT":     "MU US Equity",
  "SNDKUSDT":   "SNDK US Equity",
  "MSFTUSDT":   "MSFT US Equity",
  "AVGOUSDT":   "AVGO US Equity",
  "BABAUSDT":   "BABA US Equity",
  "AMDUSDT":    "AMD US Equity",
  "QCOMUSDT":   "QCOM US Equity",
  "USARUSDT":   "USAR US Equity",
  "LITEUSDT":   "LITE US Equity",
  "ORCLUSDT":   "ORCL US Equity",
  "DISUSDT":    "DIS US Equity",
  "UBERUSDT":   "UBER US Equity",
  "CSCOUSDT":   "CSCO US Equity",
  "HDUSDT":     "HD US Equity",
  "CRWVUSDT":   "CRWV US Equity",
  "WMTUSDT":    "WMT US Equity",
  "JPMUSDT":    "JPM US Equity",
  "VUSDT":      "V US Equity",
  "BRKBUSDT":   "BRK/B US Equity",
  "FLNCUSDT":   "FLNC US Equity",
  "DRAMUSDT":   "DRAM US Equity",
  "RKLBUSDT":   "RKLB US Equity",
  "CBRSUSDT":   "CBRS US Equity"
};

// BBG ticker → Binance 合约 反向映射
const BBG_REVERSE_MAP = Object.fromEntries(
  Object.entries(BBG_SYMBOL_MAP).map(([k, v]) => [v, k])
);

// 内存缓存：{ binanceSymbol: { price, updatedAt } }
const bbgPriceCache = new Map();
let bbgLastFetchOk = 0;  // 上次成功拉取时间

async function fetchBBGPricesOnce() {
  const securities = [];
  for (const [binanceSymbol, bbgTicker] of Object.entries(BBG_SYMBOL_MAP)) {
    if (US_EQUITY_SYMBOLS.has(binanceSymbol)) {
      if (isUSEquityExtendedOpen()) securities.push(bbgTicker);
    } else if (CME_NYMEX_SYMBOLS.has(binanceSymbol)) {
      if (isCMENymexMarketOpen()) securities.push(bbgTicker);
    }
  }

  if (securities.length === 0) {
    console.log("[BBG] 所有相关市场休市，跳过本轮拉取");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BBG_REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BBG_BASE_URL}/api/reference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        securities,
        fields: ["PX_LAST"]
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`BBG HTTP ${res.status}`);
    }

    const json = await res.json();
    const data = json.data || {};
    const now = Date.now();
    let okCount = 0;

    for (const [bbgTicker, fields] of Object.entries(data)) {
      const binanceSymbol = BBG_REVERSE_MAP[bbgTicker];
      if (!binanceSymbol) continue;
      const price = Number(fields && fields.PX_LAST);
      if (!Number.isFinite(price)) continue;
      bbgPriceCache.set(binanceSymbol, { price, updatedAt: now });
      okCount += 1;
    }

    bbgLastFetchOk = now;
    console.log(`[BBG] 拉取成功：${okCount}/${securities.length} 个标的有价格`);
  } catch (err) {
    console.log(`[BBG] 拉取失败：${err.name === "AbortError" ? "超时" : err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function getBBGSnapshot() {
  const out = {};
  const now = Date.now();
  for (const [symbol, entry] of bbgPriceCache.entries()) {
    if (now - entry.updatedAt > BBG_STALE_THRESHOLD_MS) continue;  // 数据过期视为离线
    out[symbol] = { price: entry.price, updatedAt: entry.updatedAt };
  }
  return out;
}

// 启动后立即拉一次，然后定时
setTimeout(() => {
  fetchBBGPricesOnce().catch(() => {});
  setInterval(() => {
    fetchBBGPricesOnce().catch(() => {});
  }, BBG_REFRESH_MS);
}, 2000);

// ============== BBG 模块结束 ==============

const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const FUNDING_ALERT_THRESHOLD = 0.001;
const lastAlertSentAt = new Map();

let alertHistory = [];

const US_EQUITY_SYMBOLS = new Set([
  "TSLAUSDT", "HOODUSDT", "MSTRUSDT", "COINUSDT", "PLTRUSDT",
  "METAUSDT", "NVDAUSDT", "GOOGLUSDT", "AAPLUSDT", "TSMUSDT",
  "SNDKUSDT", "INTCUSDT", "AMZNUSDT", "CRCLUSDT", "PAYPUSDT",
  "EWYUSDT", "EWJUSDT", "QQQUSDT", "SPYUSDT", "MUUSDT",
  "MSFTUSDT", "AVGOUSDT", "BABAUSDT", "AMDUSDT", "QCOMUSDT", "USARUSDT",
  "LITEUSDT", "ORCLUSDT", "DISUSDT", "UBERUSDT", "CSCOUSDT", "HDUSDT",
  "CRWVUSDT", "WMTUSDT", "JPMUSDT", "VUSDT", "BRKBUSDT", "FLNCUSDT",
  "DRAMUSDT", "RKLBUSDT", "CBRSUSDT"
]);

const CME_NYMEX_SYMBOLS = new Set([
  "CLUSDT", "BZUSDT", "NATGASUSDT", "COPPERUSDT",
  "XAUUSDT", "XAGUSDT", "XPTUSDT", "XPDUSDT"
]);

const US_EQUITY_HOLIDAYS_ET_2026 = new Set([
  "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"
]);

const app = express();
const PORT = 3000;

const SYMBOLS = new Set([
  "XAUUSDT", "XAGUSDT", "TSLAUSDT", "XPTUSDT", "XPDUSDT", "INTCUSDT",
  "HOODUSDT", "MSTRUSDT", "AMZNUSDT", "CRCLUSDT", "COINUSDT", "PLTRUSDT",
  "COPPERUSDT", "EWYUSDT", "EWJUSDT", "PAYPUSDT", "METAUSDT", "NVDAUSDT",
  "GOOGLUSDT", "CLUSDT", "BZUSDT", "NATGASUSDT", "QQQUSDT", "SPYUSDT",
  "AAPLUSDT", "TSMUSDT", "MUUSDT", "SNDKUSDT",
  "MSFTUSDT", "AVGOUSDT", "BABAUSDT", "AMDUSDT", "QCOMUSDT", "USARUSDT",
  "LITEUSDT", "ORCLUSDT", "DISUSDT", "UBERUSDT", "CSCOUSDT", "HDUSDT",
  "CRWVUSDT", "WMTUSDT", "JPMUSDT", "VUSDT", "BRKBUSDT", "FLNCUSDT",
  "DRAMUSDT", "RKLBUSDT", "CBRSUSDT"
]);

/** 美东日历 YYYY-MM-DD（America/New_York） */
function getCalendarDateET(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(date);
}

/** 美东星期 0=周日 … 6=周六 */
function getWeekdayET(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short"
  });
  const parts = formatter.formatToParts(date);
  const w = (parts.find((p) => p.type === "weekday")?.value || "").replace(/\.$/, "");
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[w] ?? 0;
}

/** 美东当日 0 点起的分钟数 */
function getMinutesSinceMidnightET(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === "hour") hour = parseInt(p.value, 10) || 0;
    if (p.type === "minute") minute = parseInt(p.value, 10) || 0;
  }
  return hour * 60 + minute;
}

function isUSEquityMarketOpen(now = new Date()) {
  const dateKey = getCalendarDateET(now);
  const year = parseInt(dateKey.slice(0, 4), 10);
  if (year === 2026 && US_EQUITY_HOLIDAYS_ET_2026.has(dateKey)) {
    return false;
  }
  const wd = getWeekdayET(now);
  if (wd === 0 || wd === 6) return false;
  const minutes = getMinutesSinceMidnightET(now);
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return minutes >= open && minutes < close;
}

// 美股扩展时段：04:00 - 20:00 ET（盘前+盘中+盘后），周末和节假日休市
function isUSEquityExtendedOpen(now = new Date()) {
  const dateKey = getCalendarDateET(now);
  const year = parseInt(dateKey.slice(0, 4), 10);
  if (year === 2026 && US_EQUITY_HOLIDAYS_ET_2026.has(dateKey)) {
    return false;
  }
  const wd = getWeekdayET(now);
  if (wd === 0 || wd === 6) return false;
  const minutes = getMinutesSinceMidnightET(now);
  const open = 4 * 60;           // 04:00 ET
  const close = 20 * 60;         // 20:00 ET
  return minutes >= open && minutes < close;
}

function isCMENymexMarketOpen(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const dateKey = `${y}-${m}-${d}`;
  const wd = now.getUTCDay();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  if (dateKey === "2026-04-03" && minutes >= 17 * 60) {
    return false;
  }
  if (minutes >= 22 * 60 && minutes < 23 * 60) return false;
  if (wd === 6) return false;
  if (wd === 0 && minutes < 23 * 60) return false;
  return true;
}

function isTraditionalExchangeOpen(symbol) {
  if (US_EQUITY_SYMBOLS.has(symbol)) {
    return isUSEquityMarketOpen();
  }
  if (CME_NYMEX_SYMBOLS.has(symbol)) {
    return isCMENymexMarketOpen();
  }
  return false;
}

function formatFundingPercent(rateDecimal) {
  const v = Number(rateDecimal) * 100;
  if (!Number.isFinite(v)) return "-";
  return `${v.toFixed(4)}%`;
}

function formatTimeUTC(date) {
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatTimeUTC8(date) {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false
  });
}

function formatNextFundingUTC8(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Date(n).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false
  });
}

let mailTransporter = null;
function getMailTransporter() {
  const pass = EMAIL_CONFIG.gmailAppPassword.replace(/\s/g, "");
  if (!pass) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: EMAIL_CONFIG.gmailUser,
        pass
      }
    });
  }
  return mailTransporter;
}

async function sendFundingAlertEmail(item, remainingMinutes) {
  const transporter = getMailTransporter();
  if (!transporter) {
    console.log("[ALERT] 跳过邮件发送：gmailAppPassword 为空");
    return;
  }

  const symbol = item.symbol;
  const fundingPct = formatFundingPercent(item.lastFundingRate);
  const markPrice = item.markPrice;
  const nextFundingTime = item.nextFundingTime;
  const now = new Date();

  const subject = `⚠️ 结算预警（剩余${remainingMinutes}分钟）：${symbol} ${fundingPct}`;
  const body =
    `合约：${symbol}\n` +
    `当前资金费率：${fundingPct}\n` +
    `标记价格：${markPrice}\n` +
    `距离结算：还有 ${remainingMinutes} 分钟\n` +
    `交易所状态：开盘中\n` +
    `触发时间：${formatTimeUTC(now)} / ${formatTimeUTC8(now)}\n` +
    `下次结算时间：${formatNextFundingUTC8(nextFundingTime)}`;

  console.log(`[ALERT] 发送邮件：${symbol} ${fundingPct}`);

  await transporter.sendMail({
    from: EMAIL_CONFIG.from,
    to: EMAIL_CONFIG.to,
    subject,
    text: body
  });

  console.log("[ALERT] 邮件发送成功");

  alertHistory.push({
    symbol: item.symbol,
    markPrice: item.markPrice,
    fundingRate: item.lastFundingRate,
    timestamp: Date.now()
  });
  while (alertHistory.length > 100) {
    alertHistory.shift();
  }
}

function processPremiumAlerts(data) {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  for (const item of data) {
    if (!item || !item.symbol) continue;
    const symbol = item.symbol;
    if (!SYMBOLS.has(symbol)) continue;

    const rate = Number(item.lastFundingRate);
    if (!Number.isFinite(rate) || Math.abs(rate) <= FUNDING_ALERT_THRESHOLD) continue;
    const timeToNextFunding = Number(item.nextFundingTime) - now;
    if (!Number.isFinite(timeToNextFunding) || timeToNextFunding <= 0 || timeToNextFunding > oneHour) continue;
    if (!isTraditionalExchangeOpen(symbol)) continue;

    const last = lastAlertSentAt.get(symbol) || 0;
    if (now - last < ALERT_COOLDOWN_MS) {
      console.log(`[ALERT] 冷却中，跳过：${symbol}`);
      continue;
    }

    lastAlertSentAt.set(symbol, now);
    const remainingMinutes = Math.ceil(timeToNextFunding / (60 * 1000));
    sendFundingAlertEmail(item, remainingMinutes).catch((err) => {
      console.log(`[ALERT] 邮件发送失败：${symbol} ${err.message}`);
      lastAlertSentAt.delete(symbol);
    });
  }
}

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
    setImmediate(() => {
      try {
        processPremiumAlerts(data);
      } catch (e) {
        console.log(`[ALERT] 推送检查异常：${e.message}`);
      }
    });
  } catch (error) {
    res.status(502).json({
      success: false,
      error: error.name === "AbortError" ? "请求 Binance 超时" : error.message
    });
  }
});

app.get("/api/last-price", async (req, res) => {
  try {
    const response = await withTimeout("https://fapi.binance.com/fapi/v1/ticker/price");
    if (!response.ok) {
      throw new Error(`Binance ticker/price HTTP ${response.status}`);
    }
    const raw = await response.json();
    const list = Array.isArray(raw) ? raw : raw && raw.symbol ? [raw] : [];
    const data = list
      .filter((item) => item && item.symbol && SYMBOLS.has(item.symbol))
      .map((item) => ({
        symbol: item.symbol,
        price: item.price
      }));
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

app.get("/api/alert-history", (req, res) => {
  res.json({ success: true, data: alertHistory });
});

app.get("/api/bbg-prices", (req, res) => {
  res.json({
    success: true,
    data: getBBGSnapshot(),
    lastFetchOk: bbgLastFetchOk,
    online: Date.now() - bbgLastFetchOk < BBG_STALE_THRESHOLD_MS
  });
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
