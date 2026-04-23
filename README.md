Binance 永续合约资金费率监控系统
这是一个基于 Node.js 的轻量级监控工具，专门用于追踪指定标的（美股/大宗商品相关合约）在币安（Binance）永续合约市场的资金费率。系统会自动判断传统市场的开盘时间，并在费率异常时通过邮件发送实时预警。

🌟 核心功能
多维度监控：实时获取 20+ 关键合约（TSLA, NVDA, XAU, CL 等）的资金费率。

开盘逻辑检查：智能识别 美股 (NYSE/NASDAQ) 和 CME (NYMEX) 的开盘、收盘、周末及 2026 年节假日。仅在开盘时间段内触发预警，避免无效信息骚扰。

邮件预警系统：当资金费率绝对值超过阈值（默认 0.1%）时，自动发送明细邮件。

推送历史记录：前端内置“推送历史”弹窗，可查看最近 100 条触发的预警明细（合约、价格、费率、时间）。

极简可视化面板：

高费率合约统计。

倒计时提醒（结算时间）。

费率趋势箭头指示。

按高费率/正负费率快速筛选。

🛠️ 技术栈
后端: Node.js, Express, Nodemailer

数据源: Binance API (fapi/v1/premiumIndex)

前端: Vanilla JS (ES6+), CSS3 (变量/弹性布局)

部署: PM2

🚀 快速部署
1. 配置环境
确保你的服务器已安装 Node.js (推荐 v16+)。

2. 克隆并安装
Bash
git clone https://github.com/SeanHuang001/fudingrate.git
cd fudingrate
npm install
3. 配置邮件服务
在 server.js 中修改 EMAIL_CONFIG：

to: 接收预警的邮箱地址。

gmailAppPassword: Gmail 的“应用专用密码”（需开启 2FA）。

4. 启动程序
推荐使用 PM2 进行后台持久化运行：

Bash
# 安装 PM2
npm install -g pm2

# 启动并命名
pm2 start server.js --name funding-monitor

# 查看实时日志
pm2 logs funding-monitor
📅 市场逻辑规范
美股合约: 遵循美东时间（ET）09:30 - 16:00，包含 2026 年休市日逻辑。

CME/大宗商品: 遵循 UTC 交易时段，排除周六及每日结算休市时段。

冷却机制: 同一标的在 4 小时内（ALERT_COOLDOWN_MS）仅会发送一次邮件，防止邮件炸弹。

📊 API 接口
GET /api/premium: 获取所有监控标的的当前费率。

GET /api/alert-history: 获取内存中存储的最近推送历史。

GET /api/funding-rate/:symbol: 查询特定标的的最近一次结算费率。

📝 许可证
个人学习与研究使用，交易有风险，预警仅供参考。
