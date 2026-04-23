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

const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const FUNDING_ALERT_THRESHOLD = 0.001;
const lastAlertSentAt = new Map();

let alertHistory = [];

const US_EQUITY_SYMBOLS = new Set([
  "TSLAUSDT", "HOODUSDT", "MSTRUSDT", "COINUSDT", "PLTRUSDT",
  "METAUSDT", "NVDAUSDT", "GOOGLUSDT", "AAPLUSDT", "TSMUSDT",
  "SNDKUSDT", "INTCUSDT", "AMZNUSDT", "CRCLUSDT", "PAYPUSDT",
  "EWYUSDT", "EWJUSDT", "QQQUSDT", "SPYUSDT", "MUUSDT"
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
  "AAPLUSDT", "TSMUSDT", "MUUSDT", "SNDKUSDT"
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

async function sendFundingAlertEmail(item) {
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

  const subject = `⚠️ 资金费率预警：${symbol} ${fundingPct}`;
  const body =
    `合约：${symbol}\n` +
    `当前资金费率：${fundingPct}\n` +
    `标记价格：${markPrice}\n` +
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
  for (const item of data) {
    if (!item || !item.symbol) continue;
    const symbol = item.symbol;
    if (!SYMBOLS.has(symbol)) continue;

    const rate = Number(item.lastFundingRate);
    if (!Number.isFinite(rate) || Math.abs(rate) <= FUNDING_ALERT_THRESHOLD) continue;
    if (!isTraditionalExchangeOpen(symbol)) continue;

    const last = lastAlertSentAt.get(symbol) || 0;
    if (now - last < ALERT_COOLDOWN_MS) {
      console.log(`[ALERT] 冷却中，跳过：${symbol}`);
      continue;
    }

    lastAlertSentAt.set(symbol, now);
    sendFundingAlertEmail(item).catch((err) => {
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

app.get("/api/alert-history", (req, res) => {
  res.json({ success: true, data: alertHistory });
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
