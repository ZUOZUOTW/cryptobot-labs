import type { Locale } from "./locales";
import generatedAr from "./generated/ar.json";
import generatedEn from "./generated/en.json";
import generatedJa from "./generated/ja.json";
import generatedRu from "./generated/ru.json";
import generatedZhHans from "./generated/zh-Hans.json";
import generatedZhHant from "./generated/zh-Hant.json";

/**
 * Short, intentionally all-caps visual labels that do not contain Chinese in
 * the source JSX. Keeping them here prevents decorative copy and demo status
 * values from being mistaken for product names and left untranslated.
 */
const reviewedDecorativeMessages: Record<Locale, Record<string, string>> = {
  "zh-Hant": {
    "AUTOMATION LAUNCHER": "自動交易啟動器", "WEEX FUTURES DEMO": "WEEX 合約模擬",
    "VIP code": "VIP 代碼", "RISK": "風險", "Profit Factor": "獲利因子", "Sharpe": "夏普比率",
    "0 ERRORS": "0 個錯誤", "01 / SAVE": "01 / 儲存", "01 SIGNAL": "01 訊號", "02 MODEL": "02 模型", "03 RISK": "03 風險", "ASSEMBLY BUS / 03 MODULES": "組裝匯流排 / 03 模組", "Client": "用戶端", "Correlation": "相關性", "IMPORT PREVIEW": "匯入預覽", "KLINES /": "K 線 /", "LIVE BUILD": "即時建置", "STATIC CHECK PASSED": "靜態檢查通過", "STRATEGY READY": "策略已就緒", "VERIFIED MARKET DATA /": "已驗證市場資料 /", "VISUAL STRATEGY ASSEMBLY": "視覺化策略組裝",
    "RUN /": "運行 /", "BOTS": "機器人", "02 / PARAMETERS": "02 / 參數", "04 / SAVE & SHARE": "04 / 保存與分享", "03 / HISTORICAL TEST": "03 / 歷史測試", "01 / INERT SOURCE": "01 / 隔離原始碼", "01 / STRATEGY BLOCKS": "01 / 策略模組", "ORBITAL BOT LEAGUE / SEASON 01": "軌道機器人聯賽 / 第 01 季", "PUBLIC STRATEGY /": "公開策略 /", "/ V1": "/ 版本 1",
    "CLOUD RUN /": "雲端運行 /",
    "FULL RANKING /": "完整排名 /",
    "CONTROLLED RUN /": "受控運行 /",
    "PAGE NOT FOUND / 404": "找不到頁面 / 404", "SHARING DASHBOARD / DEMO": "分享數據面板 / 展示", "LIVE ACCESS GATE": "實盤存取關卡", "TRADING CONTROL CENTER": "交易控制中心", "AGENT EVIDENCE": "代理執行證據", "PICK / SIMULATE / RUN": "挑選 / 模擬 / 運行", "NO-CODE WORKSHOP": "無程式碼組裝車間", "ADVANCED MODE": "進階模式", "START WITH EVIDENCE": "從證據開始", "OPEN LEARNING / LEGAL & RISK": "開放學習 / 法律與風險", "SIMULATION EVIDENCE": "模擬執行證據", "IMMEDIATE STOP": "立即停止", "VERIFIED HISTORICAL BACKTEST": "已驗證歷史回測", "STARTING EQUITY": "初始資金", "MARKET DATA": "市場資料", "TOP PERFORMERS / 30 DAYS": "領先策略 / 30 天", "PERFORMANCE TREND": "績效趨勢", "TRADING BATTLE / CLICK A LINE": "交易戰況 / 點選曲線", "RISK / RETURN MAP": "風險 / 收益分布", "ADMIN / USERS / DEMO": "管理 / 會員 / 展示", "AUTOMATED STRATEGY LAB / 01": "自動策略實驗室 / 01", "AI STRATEGY OBSERVATORY": "AI 策略觀測站", "STEP 00 / SIGN IN": "步驟 00 / 登入", "ACCOUNT CHECK": "帳戶確認", "OFFICIAL AUTHORIZATION": "官方授權", "SECURITY CHECK": "安全驗證", "SIMULATION FIRST": "模擬優先", "EMERGENCY CONTROLS": "緊急控制", "HIGH-RISK ACTION": "高風險操作", "VERIFIED MARKET DATA": "已驗證市場資料", "CLOUD EXECUTOR / DEMO": "雲端執行器 / 展示", "ADMIN / SHARING / DEMO": "管理 / 分享 / 展示", "LOCAL CREDENTIAL VAULT": "本機憑證保管庫", "DEPLOY TO LOCAL AGENT": "部署至本機代理", "YOUR AGENT RUNS": "你的代理運行", "WEEX OAUTH / CLOUD EXECUTION": "WEEX OAuth / 雲端執行", "FAIL CLOSED": "安全關閉", "EQUITY CURVE": "收益曲線", "PERIOD PERFORMANCE": "分段表現", "SECURE PAIRING": "安全配對", "DEMO ADMIN": "展示後台", "AUDIT & ORDER EVIDENCE": "稽核與訂單證據", "TRUSTED DEVICES": "受信任裝置", "LOCAL EXECUTION AGENT": "本機執行代理", "APPEND-ONLY EVIDENCE": "僅可附加的證據", "LIVE STRATEGY SUMMARY": "實盤策略摘要", "PUBLIC MARKET DATA": "公開市場資料", "YOUR EVIDENCE LOG": "你的證據紀錄", "VERIFIED EVIDENCE": "已驗證證據", "WELCOME BACK": "歡迎回來", "PUBLIC STRATEGIES / 01": "公開策略 / 01", "MEMBER STRATEGY VAULT": "會員策略庫", "NO MATCHES": "沒有符合項目", "STRATEGY SNAPSHOT": "策略概覽", "STRATEGY FLOW": "策略流程", "TRADE CAPABILITY": "交易能力", "COPY THIS VERSION": "複製此版本", "HISTORICAL EVIDENCE VAULT": "歷史證據庫", "ORBITAL LAB / QUICK ASSEMBLY": "軌道實驗室 / 快速組裝", "WEEX OAUTH / PRODUCT DEMO": "WEEX OAuth / 產品展示", "LEGAL / RISK": "法律 / 風險", "CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH": "CryptoBot Labs / 自動策略研究", "ORBITAL TRUST": "軌道信任", "SECURE ACCESS": "安全存取", "LIVE DATA": "即時資料", "02 / SHARE": "02 / 分享", "VERSION LINK": "版本連結", "MEMBER": "會員", "active": "啟用中", "inactive": "未啟用", "pending": "待審核", "user": "會員", "creator": "創作者", "admin": "管理員",
    "WEEX LIVE / USDT": "WEEX 實盤 / USDT",
    "DEPLOY TO 24/7 CLOUD": "部署至 24/7 雲端",
    "AWS EXECUTOR / ALWAYS ON": "AWS 執行器 / 全天運行",
    "LEGACY RUN EVIDENCE": "舊版運行證據",
    "LIVE API ACCOUNT": "實盤 API 帳戶",
    "API ACCOUNT": "API 帳戶",
    "ASSET ALLOCATION": "資產配置",
    "REALIZED NET PNL": "已實現淨損益",
    "EXECUTION EVIDENCE": "執行證據",
    "TRADING UNIVERSE": "交易範圍",
    "OPEN POSITIONS": "未平倉部位",
    "SIGN IN REQUIRED": "需要登入",
    "CLOUD CREDENTIAL VAULT": "雲端憑證保管庫",
    "Secret Key": "私密金鑰",
    "Passphrase": "API 密語",
    "ADD TO HOME SCREEN": "加入主畫面",
    "OFFLINE / READ ONLY": "離線 / 唯讀",
    "LIVE TRADING CONSOLE": "實盤交易控制台",
    "LEGACY HISTORY": "舊版紀錄",
    "WEEX API / AUTOMATED EXECUTION": "WEEX API / 自動執行",
    "AVAILABLE NOW / MANUAL API": "現已開放 / 手動 API",
    "OPTIONAL / WEEX OAUTH": "選用 / WEEX OAuth",
    "COMING SOON": "即將推出",
    "COMMUNITY / VERIFIED": "會員發布 / 已驗證",
    "COMMUNITY STRATEGY / IMMUTABLE VERSION": "會員策略 / 固定版本",
    "VERIFIED SNAPSHOT": "已驗證摘要", "VERIFIED PERFORMANCE": "已驗證績效",
    "START WITH WEEX": "從 WEEX 開始", "COMMUNITY RELEASES": "會員公開發布",
    "AWS EXECUTOR /": "AWS 執行器 /",
    "LIVE EXECUTION EVIDENCE": "實盤執行證據",
    "SECURE ACCOUNT ACCESS": "安全帳戶存取",
    "SYNC INTERRUPTED": "同步中斷",
    "RUN EVIDENCE HISTORY": "運行證據歷史",
    "NEW AUTOMATION": "新自動化策略",
    "SAFE ROLLOUT HOLD": "安全發布暫停",
    "04 / SAVE · PUBLISH · SHARE": "04 / 保存 · 發布 · 分享",
    "02 / PUBLISH": "02 / 發布",
    "PUBLIC LIST": "公開列表",
    "03 / SHARE": "03 / 分享",
    "WEEX / USDT": "WEEX 市場 / USDT", "收藏保存在此瀏覽器": "收藏保存在此瀏覽器", "v": "版本",
    "STRATEGY SHARE STUDIO": "策略分享工作室", "AUTO-GENERATED CAPTION": "自動生成文案", "SHARE TO SOCIAL": "分享至社群", "WEEX /": "WEEX 市場 /",
  },
  "zh-Hans": {
    "AUTOMATION LAUNCHER": "自动交易启动器", "WEEX FUTURES DEMO": "WEEX 合约模拟",
    "VIP code": "VIP 代码", "RISK": "风险", "Profit Factor": "盈利因子", "Sharpe": "夏普比率",
    "0 ERRORS": "0 个错误", "01 / SAVE": "01 / 保存", "01 SIGNAL": "01 信号", "02 MODEL": "02 模型", "03 RISK": "03 风险", "ASSEMBLY BUS / 03 MODULES": "组装总线 / 03 模块", "Client": "客户端", "Correlation": "相关性", "IMPORT PREVIEW": "导入预览", "KLINES /": "K 线 /", "LIVE BUILD": "实时构建", "STATIC CHECK PASSED": "静态检查通过", "STRATEGY READY": "策略已就绪", "VERIFIED MARKET DATA /": "已验证市场数据 /", "VISUAL STRATEGY ASSEMBLY": "可视化策略组装",
    "RUN /": "运行 /", "BOTS": "机器人", "02 / PARAMETERS": "02 / 参数", "04 / SAVE & SHARE": "04 / 保存与分享", "03 / HISTORICAL TEST": "03 / 历史测试", "01 / INERT SOURCE": "01 / 隔离源代码", "01 / STRATEGY BLOCKS": "01 / 策略模块", "ORBITAL BOT LEAGUE / SEASON 01": "轨道机器人联赛 / 第 01 季", "PUBLIC STRATEGY /": "公开策略 /", "/ V1": "/ 版本 1",
    "CLOUD RUN /": "云端运行 /",
    "FULL RANKING /": "完整排名 /",
    "CONTROLLED RUN /": "受控运行 /",
    "PAGE NOT FOUND / 404": "找不到页面 / 404", "SHARING DASHBOARD / DEMO": "分享数据面板 / 演示", "LIVE ACCESS GATE": "实盘访问关卡", "TRADING CONTROL CENTER": "交易控制中心", "AGENT EVIDENCE": "代理执行证据", "PICK / SIMULATE / RUN": "挑选 / 模拟 / 运行", "NO-CODE WORKSHOP": "无代码组装车间", "ADVANCED MODE": "高级模式", "START WITH EVIDENCE": "从证据开始", "OPEN LEARNING / LEGAL & RISK": "开放学习 / 法律与风险", "SIMULATION EVIDENCE": "模拟执行证据", "IMMEDIATE STOP": "立即停止", "VERIFIED HISTORICAL BACKTEST": "已验证历史回测", "STARTING EQUITY": "初始资金", "MARKET DATA": "市场数据", "TOP PERFORMERS / 30 DAYS": "领先策略 / 30 天", "PERFORMANCE TREND": "绩效趋势", "TRADING BATTLE / CLICK A LINE": "交易战况 / 点击曲线", "RISK / RETURN MAP": "风险 / 收益分布", "ADMIN / USERS / DEMO": "管理 / 用户 / 演示", "AUTOMATED STRATEGY LAB / 01": "自动策略实验室 / 01", "AI STRATEGY OBSERVATORY": "AI 策略观测站", "STEP 00 / SIGN IN": "步骤 00 / 登录", "ACCOUNT CHECK": "账户确认", "OFFICIAL AUTHORIZATION": "官方授权", "SECURITY CHECK": "安全验证", "SIMULATION FIRST": "模拟优先", "EMERGENCY CONTROLS": "紧急控制", "HIGH-RISK ACTION": "高风险操作", "VERIFIED MARKET DATA": "已验证市场数据", "CLOUD EXECUTOR / DEMO": "云端执行器 / 演示", "ADMIN / SHARING / DEMO": "管理 / 分享 / 演示", "LOCAL CREDENTIAL VAULT": "本地凭证保管库", "DEPLOY TO LOCAL AGENT": "部署到本地代理", "YOUR AGENT RUNS": "你的代理运行", "WEEX OAUTH / CLOUD EXECUTION": "WEEX OAuth / 云端执行", "FAIL CLOSED": "安全关闭", "EQUITY CURVE": "收益曲线", "PERIOD PERFORMANCE": "分段表现", "SECURE PAIRING": "安全配对", "DEMO ADMIN": "演示后台", "AUDIT & ORDER EVIDENCE": "审计与订单证据", "TRUSTED DEVICES": "受信任设备", "LOCAL EXECUTION AGENT": "本地执行代理", "APPEND-ONLY EVIDENCE": "仅可追加的证据", "LIVE STRATEGY SUMMARY": "实盘策略摘要", "PUBLIC MARKET DATA": "公开市场数据", "YOUR EVIDENCE LOG": "你的证据记录", "VERIFIED EVIDENCE": "已验证证据", "WELCOME BACK": "欢迎回来", "PUBLIC STRATEGIES / 01": "公开策略 / 01", "MEMBER STRATEGY VAULT": "会员策略库", "NO MATCHES": "没有匹配项", "STRATEGY SNAPSHOT": "策略概览", "STRATEGY FLOW": "策略流程", "TRADE CAPABILITY": "交易能力", "COPY THIS VERSION": "复制此版本", "HISTORICAL EVIDENCE VAULT": "历史证据库", "ORBITAL LAB / QUICK ASSEMBLY": "轨道实验室 / 快速组装", "WEEX OAUTH / PRODUCT DEMO": "WEEX OAuth / 产品演示", "LEGAL / RISK": "法律 / 风险", "CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH": "CryptoBot Labs / 自动策略研究", "ORBITAL TRUST": "轨道信任", "SECURE ACCESS": "安全访问", "LIVE DATA": "实时数据", "02 / SHARE": "02 / 分享", "VERSION LINK": "版本链接", "MEMBER": "会员", "active": "启用中", "inactive": "未启用", "pending": "待审核", "user": "用户", "creator": "创作者", "admin": "管理员",
    "WEEX LIVE / USDT": "WEEX 实盘 / USDT",
    "DEPLOY TO 24/7 CLOUD": "部署到 24/7 云端",
    "AWS EXECUTOR / ALWAYS ON": "AWS 执行器 / 全天运行",
    "LEGACY RUN EVIDENCE": "旧版运行凭证",
    "LIVE API ACCOUNT": "实盘 API 账户",
    "API ACCOUNT": "API 账户",
    "ASSET ALLOCATION": "资产配置",
    "REALIZED NET PNL": "已实现净损益",
    "EXECUTION EVIDENCE": "执行凭证",
    "TRADING UNIVERSE": "交易范围",
    "OPEN POSITIONS": "未平仓仓位",
    "SIGN IN REQUIRED": "需要登录",
    "CLOUD CREDENTIAL VAULT": "云端凭证保险库",
    "Secret Key": "私密密钥",
    "Passphrase": "API 密语",
    "ADD TO HOME SCREEN": "添加到主屏幕",
    "OFFLINE / READ ONLY": "离线 / 只读",
    "LIVE TRADING CONSOLE": "实盘交易控制台",
    "LEGACY HISTORY": "旧版记录",
    "WEEX API / AUTOMATED EXECUTION": "WEEX API / 自动执行",
    "AVAILABLE NOW / MANUAL API": "现已开放 / 手动 API",
    "OPTIONAL / WEEX OAUTH": "可选 / WEEX OAuth",
    "COMING SOON": "即将推出",
    "COMMUNITY / VERIFIED": "会员发布 / 已验证",
    "COMMUNITY STRATEGY / IMMUTABLE VERSION": "会员策略 / 固定版本",
    "VERIFIED SNAPSHOT": "已验证摘要", "VERIFIED PERFORMANCE": "已验证绩效",
    "START WITH WEEX": "从 WEEX 开始", "COMMUNITY RELEASES": "会员公开发布",
    "AWS EXECUTOR /": "AWS 执行器 /",
    "LIVE EXECUTION EVIDENCE": "实盘执行证据",
    "SECURE ACCOUNT ACCESS": "安全账户访问",
    "SYNC INTERRUPTED": "同步中断",
    "RUN EVIDENCE HISTORY": "运行证据历史",
    "NEW AUTOMATION": "新自动化策略",
    "SAFE ROLLOUT HOLD": "安全发布暂停",
    "04 / SAVE · PUBLISH · SHARE": "04 / 保存 · 发布 · 分享",
    "02 / PUBLISH": "02 / 发布",
    "PUBLIC LIST": "公开列表",
    "03 / SHARE": "03 / 分享",
    "WEEX / USDT": "WEEX 市场 / USDT", "收藏保存在此瀏覽器": "收藏保存在此浏览器", "v": "版本",
    "STRATEGY SHARE STUDIO": "策略分享工作室", "AUTO-GENERATED CAPTION": "自动生成文案", "SHARE TO SOCIAL": "分享到社交平台", "WEEX /": "WEEX 市场 /",
  },
  en: {
    "AUTOMATION LAUNCHER": "AUTOMATION LAUNCHER", "WEEX FUTURES DEMO": "WEEX FUTURES DEMO",
    "VIP code": "VIP code", "RISK": "RISK", "Profit Factor": "Profit Factor", "Sharpe": "Sharpe",
    "0 ERRORS": "0 ERRORS", "01 / SAVE": "01 / SAVE", "01 SIGNAL": "01 SIGNAL", "02 MODEL": "02 MODEL", "03 RISK": "03 RISK", "ASSEMBLY BUS / 03 MODULES": "ASSEMBLY BUS / 03 MODULES", "Client": "Client", "Correlation": "Correlation", "IMPORT PREVIEW": "IMPORT PREVIEW", "KLINES /": "KLINES /", "LIVE BUILD": "LIVE BUILD", "STATIC CHECK PASSED": "STATIC CHECK PASSED", "STRATEGY READY": "STRATEGY READY", "VERIFIED MARKET DATA /": "VERIFIED MARKET DATA /", "VISUAL STRATEGY ASSEMBLY": "VISUAL STRATEGY ASSEMBLY",
    "RUN /": "RUN /", "BOTS": "BOTS", "02 / PARAMETERS": "02 / PARAMETERS", "04 / SAVE & SHARE": "04 / SAVE & SHARE", "03 / HISTORICAL TEST": "03 / HISTORICAL TEST", "01 / INERT SOURCE": "01 / INERT SOURCE", "01 / STRATEGY BLOCKS": "01 / STRATEGY BLOCKS", "ORBITAL BOT LEAGUE / SEASON 01": "ORBITAL BOT LEAGUE / SEASON 01", "PUBLIC STRATEGY /": "PUBLIC STRATEGY /", "/ V1": "/ V1",
    "CLOUD RUN /": "CLOUD RUN /",
    "FULL RANKING /": "FULL RANKING /",
    "CONTROLLED RUN /": "CONTROLLED RUN /",
    "PAGE NOT FOUND / 404": "PAGE NOT FOUND / 404", "SHARING DASHBOARD / DEMO": "SHARING DASHBOARD / DEMO", "LIVE ACCESS GATE": "LIVE ACCESS GATE", "TRADING CONTROL CENTER": "TRADING CONTROL CENTER", "AGENT EVIDENCE": "AGENT EVIDENCE", "PICK / SIMULATE / RUN": "PICK / SIMULATE / RUN", "NO-CODE WORKSHOP": "NO-CODE WORKSHOP", "ADVANCED MODE": "ADVANCED MODE", "START WITH EVIDENCE": "START WITH EVIDENCE", "OPEN LEARNING / LEGAL & RISK": "OPEN LEARNING / LEGAL & RISK", "SIMULATION EVIDENCE": "SIMULATION EVIDENCE", "IMMEDIATE STOP": "IMMEDIATE STOP", "VERIFIED HISTORICAL BACKTEST": "VERIFIED HISTORICAL BACKTEST", "STARTING EQUITY": "STARTING EQUITY", "MARKET DATA": "MARKET DATA", "TOP PERFORMERS / 30 DAYS": "TOP PERFORMERS / 30 DAYS", "PERFORMANCE TREND": "PERFORMANCE TREND", "TRADING BATTLE / CLICK A LINE": "TRADING BATTLE / CLICK A LINE", "RISK / RETURN MAP": "RISK / RETURN MAP", "ADMIN / USERS / DEMO": "ADMIN / USERS / DEMO", "AUTOMATED STRATEGY LAB / 01": "AUTOMATED STRATEGY LAB / 01", "AI STRATEGY OBSERVATORY": "AI STRATEGY OBSERVATORY", "STEP 00 / SIGN IN": "STEP 00 / SIGN IN", "ACCOUNT CHECK": "ACCOUNT CHECK", "OFFICIAL AUTHORIZATION": "OFFICIAL AUTHORIZATION", "SECURITY CHECK": "SECURITY CHECK", "SIMULATION FIRST": "SIMULATION FIRST", "EMERGENCY CONTROLS": "EMERGENCY CONTROLS", "HIGH-RISK ACTION": "HIGH-RISK ACTION", "VERIFIED MARKET DATA": "VERIFIED MARKET DATA", "CLOUD EXECUTOR / DEMO": "CLOUD EXECUTOR / DEMO", "ADMIN / SHARING / DEMO": "ADMIN / SHARING / DEMO", "LOCAL CREDENTIAL VAULT": "LOCAL CREDENTIAL VAULT", "DEPLOY TO LOCAL AGENT": "DEPLOY TO LOCAL AGENT", "YOUR AGENT RUNS": "YOUR AGENT RUNS", "WEEX OAUTH / CLOUD EXECUTION": "WEEX OAUTH / CLOUD EXECUTION", "FAIL CLOSED": "FAIL CLOSED", "EQUITY CURVE": "EQUITY CURVE", "PERIOD PERFORMANCE": "PERIOD PERFORMANCE", "SECURE PAIRING": "SECURE PAIRING", "DEMO ADMIN": "DEMO ADMIN", "AUDIT & ORDER EVIDENCE": "AUDIT & ORDER EVIDENCE", "TRUSTED DEVICES": "TRUSTED DEVICES", "LOCAL EXECUTION AGENT": "LOCAL EXECUTION AGENT", "APPEND-ONLY EVIDENCE": "APPEND-ONLY EVIDENCE", "LIVE STRATEGY SUMMARY": "LIVE STRATEGY SUMMARY", "PUBLIC MARKET DATA": "PUBLIC MARKET DATA", "YOUR EVIDENCE LOG": "YOUR EVIDENCE LOG", "VERIFIED EVIDENCE": "VERIFIED EVIDENCE", "WELCOME BACK": "WELCOME BACK", "PUBLIC STRATEGIES / 01": "PUBLIC STRATEGIES / 01", "MEMBER STRATEGY VAULT": "MEMBER STRATEGY VAULT", "NO MATCHES": "NO MATCHES", "STRATEGY SNAPSHOT": "STRATEGY SNAPSHOT", "STRATEGY FLOW": "STRATEGY FLOW", "TRADE CAPABILITY": "TRADE CAPABILITY", "COPY THIS VERSION": "COPY THIS VERSION", "HISTORICAL EVIDENCE VAULT": "HISTORICAL EVIDENCE VAULT", "ORBITAL LAB / QUICK ASSEMBLY": "ORBITAL LAB / QUICK ASSEMBLY", "WEEX OAUTH / PRODUCT DEMO": "WEEX OAUTH / PRODUCT DEMO", "LEGAL / RISK": "LEGAL / RISK", "CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH": "CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH", "ORBITAL TRUST": "ORBITAL TRUST", "SECURE ACCESS": "SECURE ACCESS", "LIVE DATA": "LIVE DATA", "02 / SHARE": "02 / SHARE", "VERSION LINK": "VERSION LINK", "MEMBER": "MEMBER", "active": "active", "inactive": "inactive", "pending": "pending", "user": "user", "creator": "creator", "admin": "admin",
    "WEEX LIVE / USDT": "WEEX LIVE / USDT",
    "DEPLOY TO 24/7 CLOUD": "DEPLOY TO 24/7 CLOUD",
    "AWS EXECUTOR / ALWAYS ON": "AWS EXECUTOR / ALWAYS ON",
    "LEGACY RUN EVIDENCE": "LEGACY RUN EVIDENCE",
    "LIVE API ACCOUNT": "LIVE API ACCOUNT",
    "API ACCOUNT": "API ACCOUNT",
    "ASSET ALLOCATION": "ASSET ALLOCATION",
    "REALIZED NET PNL": "REALIZED NET PNL",
    "EXECUTION EVIDENCE": "EXECUTION EVIDENCE",
    "TRADING UNIVERSE": "TRADING UNIVERSE",
    "OPEN POSITIONS": "OPEN POSITIONS",
    "SIGN IN REQUIRED": "SIGN IN REQUIRED",
    "CLOUD CREDENTIAL VAULT": "CLOUD CREDENTIAL VAULT",
    "Secret Key": "Secret Key",
    "Passphrase": "Passphrase",
    "ADD TO HOME SCREEN": "ADD TO HOME SCREEN",
    "OFFLINE / READ ONLY": "OFFLINE / READ ONLY",
    "LIVE TRADING CONSOLE": "LIVE TRADING CONSOLE",
    "LEGACY HISTORY": "LEGACY HISTORY",
    "WEEX API / AUTOMATED EXECUTION": "WEEX API / AUTOMATED EXECUTION",
    "AVAILABLE NOW / MANUAL API": "AVAILABLE NOW / MANUAL API",
    "OPTIONAL / WEEX OAUTH": "OPTIONAL / WEEX OAUTH",
    "COMING SOON": "COMING SOON",
    "COMMUNITY / VERIFIED": "COMMUNITY / VERIFIED",
    "COMMUNITY STRATEGY / IMMUTABLE VERSION": "COMMUNITY STRATEGY / IMMUTABLE VERSION",
    "VERIFIED SNAPSHOT": "VERIFIED SNAPSHOT", "VERIFIED PERFORMANCE": "VERIFIED PERFORMANCE",
    "START WITH WEEX": "START WITH WEEX", "COMMUNITY RELEASES": "COMMUNITY RELEASES",
    "AWS EXECUTOR /": "AWS EXECUTOR /",
    "LIVE EXECUTION EVIDENCE": "LIVE EXECUTION EVIDENCE",
    "SECURE ACCOUNT ACCESS": "SECURE ACCOUNT ACCESS",
    "SYNC INTERRUPTED": "SYNC INTERRUPTED",
    "RUN EVIDENCE HISTORY": "RUN EVIDENCE HISTORY",
    "NEW AUTOMATION": "NEW AUTOMATION",
    "SAFE ROLLOUT HOLD": "SAFE ROLLOUT HOLD",
    "04 / SAVE · PUBLISH · SHARE": "04 / SAVE · PUBLISH · SHARE",
    "02 / PUBLISH": "02 / PUBLISH",
    "PUBLIC LIST": "PUBLIC LIST",
    "03 / SHARE": "03 / SHARE",
    "WEEX / USDT": "WEEX / USDT", "收藏保存在此瀏覽器": "Favorites are saved in this browser", "v": "v",
    "STRATEGY SHARE STUDIO": "STRATEGY SHARE STUDIO", "AUTO-GENERATED CAPTION": "AUTO-GENERATED CAPTION", "SHARE TO SOCIAL": "SHARE TO SOCIAL", "WEEX /": "WEEX /",
  },
  ar: {
    "AUTOMATION LAUNCHER": "مشغّل التداول الآلي", "WEEX FUTURES DEMO": "محاكاة عقود WEEX الآجلة",
    "VIP code": "رمز VIP", "RISK": "المخاطر", "Profit Factor": "معامل الربح", "Sharpe": "نسبة شارب",
    "0 ERRORS": "0 أخطاء", "01 / SAVE": "01 / حفظ", "01 SIGNAL": "01 إشارة", "02 MODEL": "02 النموذج", "03 RISK": "03 المخاطر", "ASSEMBLY BUS / 03 MODULES": "مسار التجميع / 03 وحدات", "Client": "العميل", "Correlation": "الارتباط", "IMPORT PREVIEW": "معاينة الاستيراد", "KLINES /": "شموع K /", "LIVE BUILD": "البناء المباشر", "STATIC CHECK PASSED": "نجح الفحص الثابت", "STRATEGY READY": "الاستراتيجية جاهزة", "VERIFIED MARKET DATA /": "بيانات سوق موثقة /", "VISUAL STRATEGY ASSEMBLY": "التجميع المرئي للاستراتيجية",
    "RUN /": "تشغيل /", "BOTS": "روبوتات", "02 / PARAMETERS": "02 / المعلمات", "04 / SAVE & SHARE": "04 / الحفظ والمشاركة", "03 / HISTORICAL TEST": "03 / الاختبار التاريخي", "01 / INERT SOURCE": "01 / شفرة مصدر معزولة", "01 / STRATEGY BLOCKS": "01 / وحدات الاستراتيجية", "ORBITAL BOT LEAGUE / SEASON 01": "دوري الروبوتات المداري / الموسم 01", "PUBLIC STRATEGY /": "استراتيجية عامة /", "/ V1": "/ الإصدار 1",
    "CLOUD RUN /": "تشغيل سحابي /",
    "FULL RANKING /": "الترتيب الكامل /",
    "CONTROLLED RUN /": "تشغيل مضبوط /",
    "pending": "قيد المراجعة", "user": "مستخدم", "creator": "منشئ", "admin": "مسؤول",
    "PAGE NOT FOUND / 404": "الصفحة غير موجودة / 404", "SHARING DASHBOARD / DEMO": "لوحة المشاركة / العرض التوضيحي", "LIVE ACCESS GATE": "بوابة الوصول للتداول الفعلي", "TRADING CONTROL CENTER": "مركز التحكم بالتداول", "AGENT EVIDENCE": "أدلة الوكيل", "PICK / SIMULATE / RUN": "اختيار / محاكاة / تشغيل", "NO-CODE WORKSHOP": "ورشة بدون برمجة", "ADVANCED MODE": "الوضع المتقدم", "START WITH EVIDENCE": "ابدأ بالأدلة", "OPEN LEARNING / LEGAL & RISK": "تعلم مفتوح / الشؤون القانونية والمخاطر", "SIMULATION EVIDENCE": "أدلة المحاكاة", "IMMEDIATE STOP": "إيقاف فوري", "VERIFIED HISTORICAL BACKTEST": "اختبار تاريخي موثّق", "STARTING EQUITY": "رأس المال الابتدائي", "MARKET DATA": "بيانات السوق", "TOP PERFORMERS / 30 DAYS": "أفضل الاستراتيجيات / 30 يومًا", "PERFORMANCE TREND": "اتجاه الأداء", "TRADING BATTLE / CLICK A LINE": "منافسة التداول / انقر على خط", "RISK / RETURN MAP": "خريطة المخاطر / العائد", "ADMIN / USERS / DEMO": "الإدارة / المستخدمون / عرض توضيحي", "AUTOMATED STRATEGY LAB / 01": "مختبر الاستراتيجيات الآلية / 01", "AI STRATEGY OBSERVATORY": "مرصد استراتيجيات الذكاء الاصطناعي", "STEP 00 / SIGN IN": "الخطوة 00 / تسجيل الدخول", "ACCOUNT CHECK": "فحص الحساب", "OFFICIAL AUTHORIZATION": "التفويض الرسمي", "SECURITY CHECK": "فحص الأمان", "SIMULATION FIRST": "المحاكاة أولًا", "EMERGENCY CONTROLS": "عناصر التحكم في حالات الطوارئ", "HIGH-RISK ACTION": "إجراء عالي المخاطر", "VERIFIED MARKET DATA": "بيانات سوق موثّقة", "CLOUD EXECUTOR / DEMO": "منفذ سحابي / عرض توضيحي", "ADMIN / SHARING / DEMO": "الإدارة / المشاركة / عرض توضيحي", "LOCAL CREDENTIAL VAULT": "خزنة بيانات الاعتماد المحلية", "DEPLOY TO LOCAL AGENT": "النشر إلى الوكيل المحلي", "YOUR AGENT RUNS": "عمليات الوكيل الخاصة بك", "WEEX OAUTH / CLOUD EXECUTION": "WEEX OAuth / التنفيذ السحابي", "FAIL CLOSED": "الإغلاق الآمن", "EQUITY CURVE": "منحنى قيمة المحفظة", "PERIOD PERFORMANCE": "أداء الفترة", "SECURE PAIRING": "إقران آمن", "DEMO ADMIN": "إدارة تجريبية", "AUDIT & ORDER EVIDENCE": "التدقيق وأدلة الأوامر", "TRUSTED DEVICES": "الأجهزة الموثوقة", "LOCAL EXECUTION AGENT": "وكيل التنفيذ المحلي", "APPEND-ONLY EVIDENCE": "أدلة لا تقبل إلا الإضافة", "LIVE STRATEGY SUMMARY": "ملخص الاستراتيجية الفعلية", "PUBLIC MARKET DATA": "بيانات السوق العامة", "YOUR EVIDENCE LOG": "سجل الأدلة الخاص بك", "VERIFIED EVIDENCE": "أدلة موثّقة", "WELCOME BACK": "مرحبًا بعودتك", "PUBLIC STRATEGIES / 01": "استراتيجيات عامة / 01", "MEMBER STRATEGY VAULT": "خزنة استراتيجيات الأعضاء", "NO MATCHES": "لا توجد نتائج", "STRATEGY SNAPSHOT": "ملخص الاستراتيجية", "STRATEGY FLOW": "تدفق الاستراتيجية", "TRADE CAPABILITY": "إمكانات التداول", "COPY THIS VERSION": "انسخ هذا الإصدار", "HISTORICAL EVIDENCE VAULT": "خزنة أدلة الاختبارات التاريخية", "ORBITAL LAB / QUICK ASSEMBLY": "مختبر مداري / تجميع سريع", "WEEX OAUTH / PRODUCT DEMO": "WEEX OAuth / عرض المنتج", "LEGAL / RISK": "قانوني / مخاطر", "CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH": "CryptoBot Labs / أبحاث الاستراتيجيات الآلية", "ORBITAL TRUST": "الثقة المدارية", "SECURE ACCESS": "وصول آمن", "LIVE DATA": "بيانات فورية", "02 / SHARE": "02 / مشاركة", "VERSION LINK": "رابط الإصدار", "MEMBER": "عضو", "active": "نشط", "inactive": "غير نشط",
    "WEEX LIVE / USDT": "تداول WEEX الفعلي / USDT",
    "DEPLOY TO 24/7 CLOUD": "النشر إلى السحابة على مدار الساعة",
    "AWS EXECUTOR / ALWAYS ON": "منفّذ AWS / يعمل دائمًا",
    "LEGACY RUN EVIDENCE": "أدلة التشغيل القديمة",
    "LIVE API ACCOUNT": "حساب API للتداول الفعلي",
    "API ACCOUNT": "حساب API",
    "ASSET ALLOCATION": "توزيع الأصول",
    "REALIZED NET PNL": "صافي الربح والخسارة المحقق",
    "EXECUTION EVIDENCE": "أدلة التنفيذ",
    "TRADING UNIVERSE": "نطاق التداول",
    "OPEN POSITIONS": "المراكز المفتوحة",
    "SIGN IN REQUIRED": "تسجيل الدخول مطلوب",
    "CLOUD CREDENTIAL VAULT": "خزنة بيانات الاعتماد السحابية",
    "Secret Key": "المفتاح السري",
    "Passphrase": "عبارة المرور",
    "ADD TO HOME SCREEN": "إضافة إلى الشاشة الرئيسية",
    "OFFLINE / READ ONLY": "غير متصل / للقراءة فقط",
    "LIVE TRADING CONSOLE": "وحدة تحكم التداول الفعلي",
    "LEGACY HISTORY": "السجل القديم",
    "WEEX API / AUTOMATED EXECUTION": "WEEX API / تنفيذ آلي",
    "AVAILABLE NOW / MANUAL API": "متاح الآن / API يدوي",
    "OPTIONAL / WEEX OAUTH": "اختياري / WEEX OAuth",
    "COMING SOON": "قريبًا",
    "COMMUNITY / VERIFIED": "المجتمع / موثّق",
    "COMMUNITY STRATEGY / IMMUTABLE VERSION": "استراتيجية المجتمع / إصدار ثابت",
    "VERIFIED SNAPSHOT": "ملخص موثّق", "VERIFIED PERFORMANCE": "أداء موثّق",
    "START WITH WEEX": "ابدأ مع WEEX", "COMMUNITY RELEASES": "منشورات المجتمع",
    "AWS EXECUTOR /": "منفّذ AWS /",
    "LIVE EXECUTION EVIDENCE": "أدلة التنفيذ الفعلي",
    "SECURE ACCOUNT ACCESS": "وصول آمن إلى الحساب",
    "SYNC INTERRUPTED": "توقفت المزامنة",
    "RUN EVIDENCE HISTORY": "سجل أدلة التشغيل",
    "NEW AUTOMATION": "أتمتة جديدة",
    "SAFE ROLLOUT HOLD": "إيقاف الطرح الآمن مؤقتًا",
    "04 / SAVE · PUBLISH · SHARE": "04 / حفظ · نشر · مشاركة",
    "02 / PUBLISH": "02 / نشر",
    "PUBLIC LIST": "القائمة العامة",
    "03 / SHARE": "03 / مشاركة",
    "WEEX / USDT": "سوق WEEX / USDT", "收藏保存在此瀏覽器": "تُحفظ المفضلة في هذا المتصفح", "v": "الإصدار",
    "STRATEGY SHARE STUDIO": "استوديو مشاركة الاستراتيجية", "AUTO-GENERATED CAPTION": "نص مُنشأ تلقائيًا", "SHARE TO SOCIAL": "المشاركة على الشبكات الاجتماعية", "WEEX /": "سوق WEEX /",
  },
  ru: {
    "AUTOMATION LAUNCHER": "ЗАПУСК АВТОТОРГОВЛИ", "WEEX FUTURES DEMO": "ДЕМО ФЬЮЧЕРСОВ WEEX",
    "VIP code": "VIP-код", "RISK": "РИСК", "Profit Factor": "Фактор прибыли", "Sharpe": "Коэффициент Шарпа",
    "0 ERRORS": "0 ОШИБОК", "01 / SAVE": "01 / СОХРАНИТЬ", "01 SIGNAL": "01 СИГНАЛ", "02 MODEL": "02 МОДЕЛЬ", "03 RISK": "03 РИСК", "ASSEMBLY BUS / 03 MODULES": "ШИНА СБОРКИ / 03 МОДУЛЯ", "Client": "Клиент", "Correlation": "Корреляция", "IMPORT PREVIEW": "ПРЕДПРОСМОТР ИМПОРТА", "KLINES /": "СВЕЧИ /", "LIVE BUILD": "АКТУАЛЬНАЯ СБОРКА", "STATIC CHECK PASSED": "СТАТИЧЕСКАЯ ПРОВЕРКА ПРОЙДЕНА", "STRATEGY READY": "СТРАТЕГИЯ ГОТОВА", "VERIFIED MARKET DATA /": "ПРОВЕРЕННЫЕ РЫНОЧНЫЕ ДАННЫЕ /", "VISUAL STRATEGY ASSEMBLY": "ВИЗУАЛЬНАЯ СБОРКА СТРАТЕГИИ",
    "RUN /": "ЗАПУСК /", "BOTS": "БОТЫ", "02 / PARAMETERS": "02 / ПАРАМЕТРЫ", "04 / SAVE & SHARE": "04 / СОХРАНЕНИЕ И ПУБЛИКАЦИЯ", "03 / HISTORICAL TEST": "03 / ИСТОРИЧЕСКИЙ ТЕСТ", "01 / INERT SOURCE": "01 / ИЗОЛИРОВАННЫЙ ИСХОДНЫЙ КОД", "01 / STRATEGY BLOCKS": "01 / БЛОКИ СТРАТЕГИИ", "ORBITAL BOT LEAGUE / SEASON 01": "ОРБИТАЛЬНАЯ ЛИГА БОТОВ / СЕЗОН 01", "PUBLIC STRATEGY /": "ПУБЛИЧНАЯ СТРАТЕГИЯ /", "/ V1": "/ ВЕРСИЯ 1",
    "CLOUD RUN /": "ОБЛАЧНЫЙ ЗАПУСК /",
    "FULL RANKING /": "ПОЛНЫЙ РЕЙТИНГ /",
    "CONTROLLED RUN /": "КОНТРОЛИРУЕМЫЙ ЗАПУСК /",
    "pending": "на проверке", "user": "пользователь", "creator": "автор", "admin": "администратор",
    "PAGE NOT FOUND / 404": "СТРАНИЦА НЕ НАЙДЕНА / 404", "SHARING DASHBOARD / DEMO": "ПАНЕЛЬ ПУБЛИКАЦИЙ / ДЕМО", "LIVE ACCESS GATE": "ДОПУСК К РЕАЛЬНОЙ ТОРГОВЛЕ", "TRADING CONTROL CENTER": "ЦЕНТР УПРАВЛЕНИЯ ТОРГОВЛЕЙ", "AGENT EVIDENCE": "ДАННЫЕ АГЕНТА", "PICK / SIMULATE / RUN": "ВЫБОР / СИМУЛЯЦИЯ / ЗАПУСК", "NO-CODE WORKSHOP": "КОНСТРУКТОР БЕЗ КОДА", "ADVANCED MODE": "РАСШИРЕННЫЙ РЕЖИМ", "START WITH EVIDENCE": "НАЧНИТЕ С ДАННЫХ", "OPEN LEARNING / LEGAL & RISK": "ОТКРЫТОЕ ОБУЧЕНИЕ / ПРАВО И РИСКИ", "SIMULATION EVIDENCE": "ДАННЫЕ СИМУЛЯЦИИ", "IMMEDIATE STOP": "НЕМЕДЛЕННАЯ ОСТАНОВКА", "VERIFIED HISTORICAL BACKTEST": "ПРОВЕРЕННЫЙ ИСТОРИЧЕСКИЙ БЭКТЕСТ", "STARTING EQUITY": "НАЧАЛЬНЫЙ КАПИТАЛ", "MARKET DATA": "РЫНОЧНЫЕ ДАННЫЕ", "TOP PERFORMERS / 30 DAYS": "ЛУЧШИЕ СТРАТЕГИИ / 30 ДНЕЙ", "PERFORMANCE TREND": "ДИНАМИКА РЕЗУЛЬТАТОВ", "TRADING BATTLE / CLICK A LINE": "ТОРГОВОЕ СРАВНЕНИЕ / НАЖМИТЕ НА ЛИНИЮ", "RISK / RETURN MAP": "КАРТА РИСКА / ДОХОДНОСТИ", "ADMIN / USERS / DEMO": "АДМИНИСТРАТОР / ПОЛЬЗОВАТЕЛИ / ДЕМО", "AUTOMATED STRATEGY LAB / 01": "ЛАБОРАТОРИЯ АВТОСТРАТЕГИЙ / 01", "AI STRATEGY OBSERVATORY": "ОБЗОР СТРАТЕГИЙ ИИ", "STEP 00 / SIGN IN": "ШАГ 00 / ВХОД", "ACCOUNT CHECK": "ПРОВЕРКА АККАУНТА", "OFFICIAL AUTHORIZATION": "ОФИЦИАЛЬНАЯ АВТОРИЗАЦИЯ", "SECURITY CHECK": "ПРОВЕРКА БЕЗОПАСНОСТИ", "SIMULATION FIRST": "СНАЧАЛА СИМУЛЯЦИЯ", "EMERGENCY CONTROLS": "ЭКСТРЕННОЕ УПРАВЛЕНИЕ", "HIGH-RISK ACTION": "ВЫСОКОРИСКОВАЯ ОПЕРАЦИЯ", "VERIFIED MARKET DATA": "ПРОВЕРЕННЫЕ РЫНОЧНЫЕ ДАННЫЕ", "CLOUD EXECUTOR / DEMO": "ОБЛАЧНЫЙ ИСПОЛНИТЕЛЬ / ДЕМО", "ADMIN / SHARING / DEMO": "АДМИНИСТРАТОР / ПУБЛИКАЦИИ / ДЕМО", "LOCAL CREDENTIAL VAULT": "ЛОКАЛЬНОЕ ХРАНИЛИЩЕ УЧЁТНЫХ ДАННЫХ", "DEPLOY TO LOCAL AGENT": "РАЗВЕРНУТЬ НА ЛОКАЛЬНОМ АГЕНТЕ", "YOUR AGENT RUNS": "ЗАПУСКИ ВАШЕГО АГЕНТА", "WEEX OAUTH / CLOUD EXECUTION": "WEEX OAuth / ОБЛАЧНОЕ ИСПОЛНЕНИЕ", "FAIL CLOSED": "БЕЗОПАСНОЕ ОТКЛЮЧЕНИЕ", "EQUITY CURVE": "КРИВАЯ КАПИТАЛА", "PERIOD PERFORMANCE": "РЕЗУЛЬТАТЫ ПО ПЕРИОДАМ", "SECURE PAIRING": "БЕЗОПАСНОЕ СОПРЯЖЕНИЕ", "DEMO ADMIN": "ДЕМО-АДМИНИСТРИРОВАНИЕ", "AUDIT & ORDER EVIDENCE": "АУДИТ И ДАННЫЕ ОРДЕРОВ", "TRUSTED DEVICES": "ДОВЕРЕННЫЕ УСТРОЙСТВА", "LOCAL EXECUTION AGENT": "ЛОКАЛЬНЫЙ АГЕНТ ИСПОЛНЕНИЯ", "APPEND-ONLY EVIDENCE": "НЕИЗМЕНЯЕМЫЙ ЖУРНАЛ", "LIVE STRATEGY SUMMARY": "СВОДКА РЕАЛЬНОЙ СТРАТЕГИИ", "PUBLIC MARKET DATA": "ОТКРЫТЫЕ РЫНОЧНЫЕ ДАННЫЕ", "YOUR EVIDENCE LOG": "ВАШ ЖУРНАЛ ДАННЫХ", "VERIFIED EVIDENCE": "ПРОВЕРЕННЫЕ ДАННЫЕ", "WELCOME BACK": "С ВОЗВРАЩЕНИЕМ", "PUBLIC STRATEGIES / 01": "ПУБЛИЧНЫЕ СТРАТЕГИИ / 01", "MEMBER STRATEGY VAULT": "ХРАНИЛИЩЕ СТРАТЕГИЙ УЧАСТНИКОВ", "NO MATCHES": "НЕТ СОВПАДЕНИЙ", "STRATEGY SNAPSHOT": "ОБЗОР СТРАТЕГИИ", "STRATEGY FLOW": "ЛОГИКА СТРАТЕГИИ", "TRADE CAPABILITY": "ТОРГОВЫЕ ВОЗМОЖНОСТИ", "COPY THIS VERSION": "СКОПИРОВАТЬ ЭТУ ВЕРСИЮ", "HISTORICAL EVIDENCE VAULT": "ХРАНИЛИЩЕ ИСТОРИЧЕСКИХ ДАННЫХ", "ORBITAL LAB / QUICK ASSEMBLY": "ОРБИТАЛЬНАЯ ЛАБОРАТОРИЯ / БЫСТРАЯ СБОРКА", "WEEX OAUTH / PRODUCT DEMO": "WEEX OAuth / ДЕМО ПРОДУКТА", "LEGAL / RISK": "ПРАВО / РИСКИ", "CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH": "CryptoBot Labs / ИССЛЕДОВАНИЕ АВТОСТРАТЕГИЙ", "ORBITAL TRUST": "ОРБИТАЛЬНОЕ ДОВЕРИЕ", "SECURE ACCESS": "БЕЗОПАСНЫЙ ДОСТУП", "LIVE DATA": "ДАННЫЕ В РЕАЛЬНОМ ВРЕМЕНИ", "02 / SHARE": "02 / ПОДЕЛИТЬСЯ", "VERSION LINK": "ССЫЛКА НА ВЕРСИЮ", "MEMBER": "УЧАСТНИК", "active": "активен", "inactive": "неактивен",
    "WEEX LIVE / USDT": "WEEX — РЕАЛЬНАЯ ТОРГОВЛЯ / USDT",
    "DEPLOY TO 24/7 CLOUD": "РАЗВЕРНУТЬ В ОБЛАКЕ 24/7",
    "AWS EXECUTOR / ALWAYS ON": "ИСПОЛНИТЕЛЬ AWS / ВСЕГДА ВКЛЮЧЁН",
    "LEGACY RUN EVIDENCE": "ДАННЫЕ ПРЕДЫДУЩИХ ЗАПУСКОВ",
    "LIVE API ACCOUNT": "API-АККАУНТ РЕАЛЬНОЙ ТОРГОВЛИ",
    "API ACCOUNT": "API-АККАУНТ",
    "ASSET ALLOCATION": "РАСПРЕДЕЛЕНИЕ АКТИВОВ",
    "REALIZED NET PNL": "РЕАЛИЗОВАННАЯ ЧИСТАЯ ПРИБЫЛЬ",
    "EXECUTION EVIDENCE": "ДАННЫЕ ИСПОЛНЕНИЯ",
    "TRADING UNIVERSE": "ТОРГОВЫЕ ИНСТРУМЕНТЫ",
    "OPEN POSITIONS": "ОТКРЫТЫЕ ПОЗИЦИИ",
    "SIGN IN REQUIRED": "ТРЕБУЕТСЯ ВХОД",
    "CLOUD CREDENTIAL VAULT": "ОБЛАЧНОЕ ХРАНИЛИЩЕ УЧЁТНЫХ ДАННЫХ",
    "Secret Key": "Секретный ключ",
    "Passphrase": "Кодовая фраза",
    "ADD TO HOME SCREEN": "ДОБАВИТЬ НА ГЛАВНЫЙ ЭКРАН",
    "OFFLINE / READ ONLY": "НЕ В СЕТИ / ТОЛЬКО ЧТЕНИЕ",
    "LIVE TRADING CONSOLE": "КОНСОЛЬ РЕАЛЬНОЙ ТОРГОВЛИ",
    "LEGACY HISTORY": "ПРЕДЫДУЩАЯ ИСТОРИЯ",
    "WEEX API / AUTOMATED EXECUTION": "WEEX API / АВТОМАТИЧЕСКОЕ ИСПОЛНЕНИЕ",
    "AVAILABLE NOW / MANUAL API": "ДОСТУПНО / РУЧНОЙ API",
    "OPTIONAL / WEEX OAUTH": "НЕОБЯЗАТЕЛЬНО / WEEX OAuth",
    "COMING SOON": "СКОРО",
    "COMMUNITY / VERIFIED": "СООБЩЕСТВО / ПРОВЕРЕНО",
    "COMMUNITY STRATEGY / IMMUTABLE VERSION": "СТРАТЕГИЯ СООБЩЕСТВА / ФИКСИРОВАННАЯ ВЕРСИЯ",
    "VERIFIED SNAPSHOT": "ПРОВЕРЕННАЯ СВОДКА", "VERIFIED PERFORMANCE": "ПРОВЕРЕННЫЕ РЕЗУЛЬТАТЫ",
    "START WITH WEEX": "НАЧАТЬ С WEEX", "COMMUNITY RELEASES": "ПУБЛИКАЦИИ СООБЩЕСТВА",
    "AWS EXECUTOR /": "ИСПОЛНИТЕЛЬ AWS /",
    "LIVE EXECUTION EVIDENCE": "ДОКАЗАТЕЛЬСТВА РЕАЛЬНОГО ИСПОЛНЕНИЯ",
    "SECURE ACCOUNT ACCESS": "БЕЗОПАСНЫЙ ДОСТУП К СЧЁТУ",
    "SYNC INTERRUPTED": "СИНХРОНИЗАЦИЯ ПРЕРВАНА",
    "RUN EVIDENCE HISTORY": "ИСТОРИЯ ДОКАЗАТЕЛЬСТВ ЗАПУСКОВ",
    "NEW AUTOMATION": "НОВАЯ АВТОМАТИЗАЦИЯ",
    "SAFE ROLLOUT HOLD": "БЕЗОПАСНОЕ РАЗВЁРТЫВАНИЕ ПРИОСТАНОВЛЕНО",
    "04 / SAVE · PUBLISH · SHARE": "04 / СОХРАНИТЬ · ОПУБЛИКОВАТЬ · ПОДЕЛИТЬСЯ",
    "02 / PUBLISH": "02 / ОПУБЛИКОВАТЬ",
    "PUBLIC LIST": "ОБЩИЙ СПИСОК",
    "03 / SHARE": "03 / ПОДЕЛИТЬСЯ",
    "WEEX / USDT": "РЫНОК WEEX / USDT", "收藏保存在此瀏覽器": "Избранное сохраняется в этом браузере", "v": "версия",
    "STRATEGY SHARE STUDIO": "СТУДИЯ ПУБЛИКАЦИИ СТРАТЕГИИ", "AUTO-GENERATED CAPTION": "АВТОМАТИЧЕСКИ СОЗДАННЫЙ ТЕКСТ", "SHARE TO SOCIAL": "ПОДЕЛИТЬСЯ В СОЦСЕТЯХ", "WEEX /": "РЫНОК WEEX /",
  },
  ja: {
    "AUTOMATION LAUNCHER": "自動取引ランチャー", "WEEX FUTURES DEMO": "WEEX先物デモ",
    "VIP code": "VIPコード", "RISK": "リスク", "Profit Factor": "プロフィットファクター", "Sharpe": "シャープレシオ",
    "0 ERRORS": "エラー 0 件", "01 / SAVE": "01 / 保存", "01 SIGNAL": "01 シグナル", "02 MODEL": "02 モデル", "03 RISK": "03 リスク", "ASSEMBLY BUS / 03 MODULES": "アセンブリバス / 03 モジュール", "Client": "クライアント", "Correlation": "相関", "IMPORT PREVIEW": "インポートプレビュー", "KLINES /": "Kライン /", "LIVE BUILD": "ライブビルド", "STATIC CHECK PASSED": "静的チェック合格", "STRATEGY READY": "戦略の準備完了", "VERIFIED MARKET DATA /": "検証済み市場データ /", "VISUAL STRATEGY ASSEMBLY": "ビジュアル戦略ビルダー",
    "RUN /": "運用 /", "BOTS": "ボット", "02 / PARAMETERS": "02 / パラメーター", "04 / SAVE & SHARE": "04 / 保存・共有", "03 / HISTORICAL TEST": "03 / 過去データテスト", "01 / INERT SOURCE": "01 / 隔離ソースコード", "01 / STRATEGY BLOCKS": "01 / 戦略ブロック", "ORBITAL BOT LEAGUE / SEASON 01": "オービタル・ボットリーグ / シーズン 01", "PUBLIC STRATEGY /": "公開戦略 /", "/ V1": "/ バージョン 1",
    "CLOUD RUN /": "クラウド運用 /",
    "FULL RANKING /": "全ランキング /",
    "CONTROLLED RUN /": "管理された運用 /",
    "pending": "審査待ち", "user": "ユーザー", "creator": "作成者", "admin": "管理者",
    "PAGE NOT FOUND / 404": "ページが見つかりません / 404", "SHARING DASHBOARD / DEMO": "共有ダッシュボード / デモ", "LIVE ACCESS GATE": "実取引アクセス審査", "TRADING CONTROL CENTER": "取引コントロールセンター", "AGENT EVIDENCE": "エージェント実行記録", "PICK / SIMULATE / RUN": "選択 / シミュレーション / 実行", "NO-CODE WORKSHOP": "ノーコード組み立て", "ADVANCED MODE": "上級モード", "START WITH EVIDENCE": "実績データから始める", "OPEN LEARNING / LEGAL & RISK": "オープンラーニング / 法務・リスク", "SIMULATION EVIDENCE": "シミュレーション記録", "IMMEDIATE STOP": "即時停止", "VERIFIED HISTORICAL BACKTEST": "検証済み過去バックテスト", "STARTING EQUITY": "初期資金", "MARKET DATA": "市場データ", "TOP PERFORMERS / 30 DAYS": "上位戦略 / 30日", "PERFORMANCE TREND": "パフォーマンス推移", "TRADING BATTLE / CLICK A LINE": "取引比較 / 線をクリック", "RISK / RETURN MAP": "リスク / リターン分布", "ADMIN / USERS / DEMO": "管理 / ユーザー / デモ", "AUTOMATED STRATEGY LAB / 01": "自動戦略ラボ / 01", "AI STRATEGY OBSERVATORY": "AI戦略観測所", "STEP 00 / SIGN IN": "ステップ 00 / ログイン", "ACCOUNT CHECK": "アカウント確認", "OFFICIAL AUTHORIZATION": "公式認証", "SECURITY CHECK": "セキュリティ確認", "SIMULATION FIRST": "まずシミュレーション", "EMERGENCY CONTROLS": "緊急コントロール", "HIGH-RISK ACTION": "高リスク操作", "VERIFIED MARKET DATA": "検証済み市場データ", "CLOUD EXECUTOR / DEMO": "クラウド実行 / デモ", "ADMIN / SHARING / DEMO": "管理 / 共有 / デモ", "LOCAL CREDENTIAL VAULT": "ローカル認証情報保管庫", "DEPLOY TO LOCAL AGENT": "ローカルエージェントへ配置", "YOUR AGENT RUNS": "エージェントの運用", "WEEX OAUTH / CLOUD EXECUTION": "WEEX OAuth / クラウド実行", "FAIL CLOSED": "安全側に停止", "EQUITY CURVE": "資産曲線", "PERIOD PERFORMANCE": "期間別パフォーマンス", "SECURE PAIRING": "安全なペアリング", "DEMO ADMIN": "デモ管理", "AUDIT & ORDER EVIDENCE": "監査・注文記録", "TRUSTED DEVICES": "信頼済みデバイス", "LOCAL EXECUTION AGENT": "ローカル実行エージェント", "APPEND-ONLY EVIDENCE": "追記専用記録", "LIVE STRATEGY SUMMARY": "実取引戦略の概要", "PUBLIC MARKET DATA": "公開市場データ", "YOUR EVIDENCE LOG": "実行記録", "VERIFIED EVIDENCE": "検証済み記録", "WELCOME BACK": "おかえりなさい", "PUBLIC STRATEGIES / 01": "公開戦略 / 01", "MEMBER STRATEGY VAULT": "会員戦略ライブラリ", "NO MATCHES": "該当なし", "STRATEGY SNAPSHOT": "戦略の概要", "STRATEGY FLOW": "戦略フロー", "TRADE CAPABILITY": "取引機能", "COPY THIS VERSION": "このバージョンをコピー", "HISTORICAL EVIDENCE VAULT": "過去データ保管庫", "ORBITAL LAB / QUICK ASSEMBLY": "軌道ラボ / クイック組み立て", "WEEX OAUTH / PRODUCT DEMO": "WEEX OAuth / 製品デモ", "LEGAL / RISK": "法務 / リスク", "CRYPTOBOT LABS / AUTOMATED STRATEGY RESEARCH": "CryptoBot Labs / 自動戦略研究", "ORBITAL TRUST": "軌道トラスト", "SECURE ACCESS": "安全なアクセス", "LIVE DATA": "リアルタイムデータ", "02 / SHARE": "02 / 共有", "VERSION LINK": "バージョンリンク", "MEMBER": "会員", "active": "有効", "inactive": "無効",
    "WEEX LIVE / USDT": "WEEX ライブ / USDT",
    "DEPLOY TO 24/7 CLOUD": "24時間稼働のクラウドへ配置",
    "AWS EXECUTOR / ALWAYS ON": "AWS 実行環境 / 常時稼働",
    "LEGACY RUN EVIDENCE": "旧版の運用記録",
    "LIVE API ACCOUNT": "実取引 API アカウント",
    "API ACCOUNT": "API アカウント",
    "ASSET ALLOCATION": "資産配分",
    "REALIZED NET PNL": "実現純損益",
    "EXECUTION EVIDENCE": "実行記録",
    "TRADING UNIVERSE": "取引対象",
    "OPEN POSITIONS": "未決済ポジション",
    "SIGN IN REQUIRED": "ログインが必要です",
    "CLOUD CREDENTIAL VAULT": "クラウド認証情報保管庫",
    "Secret Key": "シークレットキー",
    "Passphrase": "パスフレーズ",
    "ADD TO HOME SCREEN": "ホーム画面に追加",
    "OFFLINE / READ ONLY": "オフライン / 読み取り専用",
    "LIVE TRADING CONSOLE": "実取引コンソール",
    "LEGACY HISTORY": "旧版の履歴",
    "WEEX API / AUTOMATED EXECUTION": "WEEX API / 自動実行",
    "AVAILABLE NOW / MANUAL API": "利用可能 / 手動 API",
    "OPTIONAL / WEEX OAUTH": "任意 / WEEX OAuth",
    "COMING SOON": "近日公開",
    "COMMUNITY / VERIFIED": "コミュニティ / 検証済み",
    "COMMUNITY STRATEGY / IMMUTABLE VERSION": "コミュニティ戦略 / 固定バージョン",
    "VERIFIED SNAPSHOT": "検証済み概要", "VERIFIED PERFORMANCE": "検証済み実績",
    "START WITH WEEX": "WEEX で始める", "COMMUNITY RELEASES": "コミュニティ公開戦略",
    "AWS EXECUTOR /": "AWS 実行環境 /",
    "LIVE EXECUTION EVIDENCE": "実取引の実行記録",
    "SECURE ACCOUNT ACCESS": "安全なアカウントアクセス",
    "SYNC INTERRUPTED": "同期が中断されました",
    "RUN EVIDENCE HISTORY": "運用記録の履歴",
    "NEW AUTOMATION": "新しい自動化",
    "SAFE ROLLOUT HOLD": "安全なロールアウトを一時停止",
    "04 / SAVE · PUBLISH · SHARE": "04 / 保存・公開・共有",
    "02 / PUBLISH": "02 / 公開",
    "PUBLIC LIST": "公開一覧",
    "03 / SHARE": "03 / 共有",
    "WEEX / USDT": "WEEX 市場 / USDT", "收藏保存在此瀏覽器": "お気に入りはこのブラウザに保存されます", "v": "バージョン",
    "STRATEGY SHARE STUDIO": "ストラテジー共有スタジオ", "AUTO-GENERATED CAPTION": "自動生成キャプション", "SHARE TO SOCIAL": "ソーシャルで共有", "WEEX /": "WEEX 市場 /",
  },
};

const reviewedTechnicalMessages: Record<Locale, Record<string, string>> = {
  "zh-Hant": {
    ...reviewedDecorativeMessages["zh-Hant"],
    "__0__連線已完成：只讀與交易能力可用，提領能力明確不存在。": "__0__連線已完成：只讀與交易能力可用，提領能力明確不存在。",
    "展示動作：已要求 __0__ 停止新訂單。": "展示動作：已要求 __0__ 停止新訂單。",
    "現貨": "現貨", "合約": "合約",
    "__0__ __1__ 尚未提供下載": "__0__ __1__ 尚未提供下載", "__0__ 不在 WEEX API 公告支援的__1__交易對中": "__0__ 不在 WEEX API 公告支援的__1__交易對中", "__0__ 不得小於 __1__": "__0__ 不得小於 __1__", "__0__ 交易績效曲線": "__0__ 交易績效曲線", "__0__ 公開策略預覽": "__0__ 公開策略預覽", "__0__ 分段表現": "__0__ 分段表現", "__0__ 包含非 JSON symbol 欄位": "__0__ 包含非 JSON symbol 欄位", "__0__ 包含非 JSON 值": "__0__ 包含非 JSON 值", "__0__ 包含非 JSON 屬性": "__0__ 包含非 JSON 屬性", "__0__ 包含非 JSON 物件": "__0__ 包含非 JSON 物件", "__0__ 包含非 JSON 陣列": "__0__ 包含非 JSON 陣列", "__0__ 天": "__0__ 天", "__0__ 必須是一般十進位字串": "__0__ 必須是一般十進位字串", "__0__ 排名趨勢": "__0__ 排名趨勢", "__0__ 收益曲線": "__0__ 收益曲線", "__0__ 筆": "__0__ 筆", "__0__ 筆 · 最近 __1__": "__0__ 筆 · 最近 __1__", "__0__ 組": "__0__ 組", "__0__ 近 30 天趨勢": "__0__ 近 30 天趨勢", "__0__ 長度不得超過 __1__": "__0__ 長度不得超過 __1__",
  },
  "zh-Hans": {
    ...reviewedDecorativeMessages["zh-Hans"],
    "__0__連線已完成：只讀與交易能力可用，提領能力明確不存在。": "__0__连接已完成：只读和交易权限可用，提现权限明确不可用。",
    "展示動作：已要求 __0__ 停止新訂單。": "演示操作：已要求 __0__ 停止创建新订单。",
    "現貨": "现货", "合約": "合约",
    "__0__ __1__ 尚未提供下載": "__0__ __1__ 尚未提供下载", "__0__ 不在 WEEX API 公告支援的__1__交易對中": "__0__ 不在 WEEX API 公告支持的__1__交易对中", "__0__ 不得小於 __1__": "__0__ 不得小于 __1__", "__0__ 交易績效曲線": "__0__ 交易绩效曲线", "__0__ 公開策略預覽": "__0__ 公开策略预览", "__0__ 分段表現": "__0__ 分段表现", "__0__ 包含非 JSON symbol 欄位": "__0__ 包含非 JSON symbol 字段", "__0__ 包含非 JSON 值": "__0__ 包含非 JSON 值", "__0__ 包含非 JSON 屬性": "__0__ 包含非 JSON 属性", "__0__ 包含非 JSON 物件": "__0__ 包含非 JSON 对象", "__0__ 包含非 JSON 陣列": "__0__ 包含非 JSON 数组", "__0__ 天": "__0__ 天", "__0__ 必須是一般十進位字串": "__0__ 必须是普通十进制字符串", "__0__ 排名趨勢": "__0__ 排名趋势", "__0__ 收益曲線": "__0__ 收益曲线", "__0__ 筆": "__0__ 条", "__0__ 筆 · 最近 __1__": "__0__ 条 · 最近 __1__", "__0__ 組": "__0__ 组", "__0__ 近 30 天趨勢": "__0__ 近 30 天趋势", "__0__ 長度不得超過 __1__": "__0__ 的长度不得超过 __1__",
  },
  en: {
    ...reviewedDecorativeMessages.en,
    "__0__連線已完成：只讀與交易能力可用，提領能力明確不存在。": "__0__ connection is complete: read and trading access are available; withdrawal access is explicitly unavailable.",
    "展示動作：已要求 __0__ 停止新訂單。": "Demo action: __0__ was instructed to stop placing new orders.",
    "現貨": "spot", "合約": "futures",
    "__0__ __1__ 尚未提供下載": "__0__ __1__ is not yet available for download.", "__0__ 不在 WEEX API 公告支援的__1__交易對中": "__0__ is not among the __1__ trading pairs supported by the WEEX API.", "__0__ 不得小於 __1__": "__0__ must not be less than __1__.", "__0__ 交易績效曲線": "__0__ trading performance curve", "__0__ 公開策略預覽": "__0__ public strategy preview", "__0__ 分段表現": "__0__ performance by period", "__0__ 包含非 JSON symbol 欄位": "__0__ contains a non-JSON symbol field", "__0__ 包含非 JSON 值": "__0__ contains non-JSON values", "__0__ 包含非 JSON 屬性": "__0__ contains non-JSON properties", "__0__ 包含非 JSON 物件": "__0__ contains non-JSON objects", "__0__ 包含非 JSON 陣列": "__0__ contains non-JSON arrays", "__0__ 天": "__0__ days", "__0__ 必須是一般十進位字串": "__0__ must be a plain decimal string.", "__0__ 排名趨勢": "__0__ ranking trend", "__0__ 收益曲線": "__0__ equity curve", "__0__ 筆": "__0__ items", "__0__ 筆 · 最近 __1__": "__0__ items · latest __1__", "__0__ 組": "__0__ groups", "__0__ 近 30 天趨勢": "__0__ trend over the past 30 days", "__0__ 長度不得超過 __1__": "The length of __0__ must not exceed __1__.",
  },
  ar: {
    ...reviewedDecorativeMessages.ar,
    "__0__連線已完成：只讀與交易能力可用，提領能力明確不存在。": "اكتمل اتصال __0__: تتوفر صلاحيتا القراءة والتداول، بينما صلاحية السحب غير متاحة صراحةً.",
    "展示動作：已要求 __0__ 停止新訂單。": "إجراء تجريبي: تم توجيه __0__ إلى التوقف عن إنشاء أوامر جديدة.",
    "現貨": "تداول فوري", "合約": "عقود آجلة",
    "__0__ __1__ 尚未提供下載": "تنزيل __0__ __1__ غير متاح بعد.", "__0__ 不在 WEEX API 公告支援的__1__交易對中": "__0__ ليس من أزواج التداول __1__ التي تدعمها واجهة WEEX API.", "__0__ 不得小於 __1__": "يجب ألا يقل __0__ عن __1__.", "__0__ 交易績效曲線": "منحنى أداء التداول لـ __0__", "__0__ 公開策略預覽": "معاينة الاستراتيجية العامة لـ __0__", "__0__ 分段表現": "أداء __0__ حسب الفترة", "__0__ 包含非 JSON symbol 欄位": "يحتوي __0__ على حقل symbol غير متوافق مع JSON", "__0__ 包含非 JSON 值": "يحتوي __0__ على قيم غير متوافقة مع JSON", "__0__ 包含非 JSON 屬性": "يحتوي __0__ على خصائص غير متوافقة مع JSON", "__0__ 包含非 JSON 物件": "يحتوي __0__ على كائنات غير متوافقة مع JSON", "__0__ 包含非 JSON 陣列": "يحتوي __0__ على مصفوفات غير متوافقة مع JSON", "__0__ 天": "__0__ يومًا", "__0__ 必須是一般十進位字串": "يجب أن يكون __0__ سلسلة رقم عشري عادية.", "__0__ 排名趨勢": "اتجاه ترتيب __0__", "__0__ 收益曲線": "منحنى قيمة المحفظة لـ __0__", "__0__ 筆": "__0__ عنصرًا", "__0__ 筆 · 最近 __1__": "__0__ عنصرًا · الأحدث __1__", "__0__ 組": "__0__ مجموعة", "__0__ 近 30 天趨勢": "اتجاه __0__ خلال آخر 30 يومًا", "__0__ 長度不得超過 __1__": "يجب ألا يتجاوز طول __0__ مقدار __1__.",
  },
  ru: {
    ...reviewedDecorativeMessages.ru,
    "__0__連線已完成：只讀與交易能力可用，提領能力明確不存在。": "Подключение __0__ завершено: доступ на чтение и торговлю включён; вывод средств явно недоступен.",
    "展示動作：已要求 __0__ 停止新訂單。": "Демо-действие: для __0__ отправлена команда прекратить создание новых ордеров.",
    "現貨": "спот", "合約": "фьючерсы",
    "__0__ __1__ 尚未提供下載": "Загрузка __0__ __1__ пока недоступна.", "__0__ 不在 WEEX API 公告支援的__1__交易對中": "__0__ не входит в список торговых пар __1__, поддерживаемых WEEX API.", "__0__ 不得小於 __1__": "__0__ не должно быть меньше __1__.", "__0__ 交易績效曲線": "Кривая торговых результатов: __0__", "__0__ 公開策略預覽": "Предварительный просмотр публичной стратегии: __0__", "__0__ 分段表現": "Результаты __0__ по периодам", "__0__ 包含非 JSON symbol 欄位": "__0__ содержит поле symbol, несовместимое с JSON", "__0__ 包含非 JSON 值": "__0__ содержит значения, несовместимые с JSON", "__0__ 包含非 JSON 屬性": "__0__ содержит свойства, несовместимые с JSON", "__0__ 包含非 JSON 物件": "__0__ содержит объекты, несовместимые с JSON", "__0__ 包含非 JSON 陣列": "__0__ содержит массивы, несовместимые с JSON", "__0__ 天": "__0__ дн.", "__0__ 必須是一般十進位字串": "__0__ должно быть обычной десятичной строкой.", "__0__ 排名趨勢": "Динамика рейтинга: __0__", "__0__ 收益曲線": "Кривая капитала: __0__", "__0__ 筆": "__0__ шт.", "__0__ 筆 · 最近 __1__": "__0__ шт. · последнее: __1__", "__0__ 組": "__0__ групп.", "__0__ 近 30 天趨勢": "Динамика __0__ за последние 30 дней", "__0__ 長度不得超過 __1__": "Длина __0__ не должна превышать __1__.",
  },
  ja: {
    ...reviewedDecorativeMessages.ja,
    "__0__連線已完成：只讀與交易能力可用，提領能力明確不存在。": "__0__の接続が完了しました。読み取りと取引の権限は利用できますが、出金権限は明示的に利用できません。",
    "展示動作：已要求 __0__ 停止新訂單。": "デモ操作：__0__に新規注文を停止するよう指示しました。",
    "現貨": "現物", "合約": "先物",
    "__0__ __1__ 尚未提供下載": "__0__ __1__はまだダウンロードできません。", "__0__ 不在 WEEX API 公告支援的__1__交易對中": "__0__はWEEX APIが対応する__1__取引ペアに含まれていません。", "__0__ 不得小於 __1__": "__0__は__1__未満にできません。", "__0__ 交易績效曲線": "__0__の取引パフォーマンス曲線", "__0__ 公開策略預覽": "__0__の公開戦略プレビュー", "__0__ 分段表現": "__0__の期間別パフォーマンス", "__0__ 包含非 JSON symbol 欄位": "__0__にJSON非対応のsymbolフィールドが含まれています", "__0__ 包含非 JSON 值": "__0__にJSON非対応の値が含まれています", "__0__ 包含非 JSON 屬性": "__0__にJSON非対応のプロパティが含まれています", "__0__ 包含非 JSON 物件": "__0__にJSON非対応のオブジェクトが含まれています", "__0__ 包含非 JSON 陣列": "__0__にJSON非対応の配列が含まれています", "__0__ 天": "__0__日", "__0__ 必須是一般十進位字串": "__0__は通常の10進数文字列である必要があります。", "__0__ 排名趨勢": "__0__のランキング推移", "__0__ 收益曲線": "__0__の資産曲線", "__0__ 筆": "__0__件", "__0__ 筆 · 最近 __1__": "__0__件 · 最終更新 __1__", "__0__ 組": "__0__組", "__0__ 近 30 天趨勢": "__0__の過去30日間の推移", "__0__ 長度不得超過 __1__": "__0__の長さは__1__を超えてはなりません。",
  },
};

/**
 * Reviewed shell and landing-page copy. The full generated catalogue augments
 * this map so every visible source phrase has the same six-locale coverage.
 */
export const reviewedMessages = {
  "zh-Hant": {
    "選擇語言": "選擇語言",
    "CryptoBot Labs｜自動交易策略實驗室": "CryptoBot Labs｜自動交易策略實驗室",
    "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。": "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。",
    "CryptoBot Labs：簡單點選，實現自動化策略": "CryptoBot Labs：簡單點選，實現自動化策略",
    "繁體中文": "繁體中文",
    "探索策略": "探索策略",
    "組裝策略": "組裝策略",
    "排行榜": "排行榜",
    "我的運行": "我的運行",
    "控制台": "控制台",
    "跳至主要內容": "跳至主要內容",
    "主要導覽": "主要導覽",
    "行動版導覽": "行動版導覽",
    "關閉導覽選單": "關閉導覽選單",
    "開啟導覽選單": "開啟導覽選單",
    "交易連線": "交易連線",
    "展示後台": "展示後台",
    "登入": "登入",
    "登出": "登出",
    "自動策略實驗室": "自動策略實驗室",
    "回測資料揭露": "回測資料揭露",
    "回測結果，不代表未來績效": "回測結果，不代表未來績效",
    "公開績效皆為歷史回測或模擬研究資料；本項目不保證資料即時性、完整性或未來結果。": "公開績效皆為歷史回測或模擬研究資料；本項目不保證資料即時性、完整性或未來結果。",
    "法律與風險資訊": "法律與風險資訊",
    "使用條款、隱私與風險": "使用條款、隱私與風險",
    "三步驟開始使用": "三步驟開始使用",
    "三步，從想法到自動實現": "三步，從想法到自動實現",
    "挑選": "挑選",
    "從現貨、合約與不同風險等級中，找到符合想法的策略起點。": "從現貨、合約與不同風險等級中，找到符合想法的策略起點。",
    "組裝": "組裝",
    "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。": "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。",
    "自動運行": "自動運行",
    "通過回測與設置後，準備開始自動運行": "通過回測與設置後，準備開始自動運行",
    "自由組裝各種策略": "自由組裝各種策略",
    "把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。": "把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。",
    "進入組裝車間": "進入組裝車間",
    "支援匯入交易策略代碼": "支援匯入交易策略代碼",
    "支持使用自行編寫的交易策略，幫助你開啟更多可能性": "支持使用自行編寫的交易策略，幫助你開啟更多可能性",
    "開啟 JavaScript 模式": "開啟 JavaScript 模式",
    "選擇策略範本，或是由你從零開始組裝": "選擇策略範本，或是由你從零開始組裝",
    "先選一個策略": "先選一個策略",
    "從空白開始": "從空白開始",
    ...reviewedTechnicalMessages["zh-Hant"],
  },
  "zh-Hans": {
    "選擇語言": "选择语言", "CryptoBot Labs｜自動交易策略實驗室": "CryptoBot Labs｜自动交易策略实验室", "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。": "探索、组装与分享自动交易策略；先用公开历史数据回测和模拟运行，再安全准备云端执行。", "CryptoBot Labs：簡單點選，實現自動化策略": "CryptoBot Labs：简单点击，实现自动化策略", "繁體中文": "繁体中文", "探索策略": "探索策略", "組裝策略": "组装策略", "排行榜": "排行榜", "我的運行": "我的运行", "控制台": "控制台",
    "跳至主要內容": "跳至主要内容", "主要導覽": "主导航", "行動版導覽": "移动版导航", "關閉導覽選單": "关闭导航菜单", "開啟導覽選單": "打开导航菜单",
    "交易連線": "交易连接", "展示後台": "演示后台", "登入": "登录", "登出": "退出登录", "自動策略實驗室": "自动策略实验室", "回測資料揭露": "回测数据披露",
    "回測結果，不代表未來績效": "回测结果不代表未来绩效", "公開績效皆為歷史回測或模擬研究資料；本項目不保證資料即時性、完整性或未來結果。": "公开绩效均为历史回测或模拟研究数据；本项目不保证数据的实时性、完整性或未来结果。",
    "法律與風險資訊": "法律与风险信息", "使用條款、隱私與風險": "使用条款、隐私与风险", "三步驟開始使用": "分三步开始使用", "三步，從想法到自動實現": "三步，从想法到自动实现",
    "挑選": "挑选", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。": "从现货、合约与不同风险等级中，找到符合想法的策略起点。", "組裝": "组装", "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。": "组装条件与风控，先用公开历史行情回测，再决定是否运行。",
    "自動運行": "自动运行", "通過回測與設置後，準備開始自動運行": "通过回测与设置后，准备开始自动运行", "自由組裝各種策略": "自由组装各种策略", "把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。": "通过点击组合进场、确认、出场、仓位与风控，轻松实现你的交易想法。",
    "進入組裝車間": "进入组装车间", "支援匯入交易策略代碼": "支持导入交易策略代码", "支持使用自行編寫的交易策略，幫助你開啟更多可能性": "支持使用自行编写的交易策略，帮助你开启更多可能性", "開啟 JavaScript 模式": "打开 JavaScript 模式",
    "選擇策略範本，或是由你從零開始組裝": "选择策略模板，或由你从零开始组装", "先選一個策略": "先选一个策略", "從空白開始": "从空白开始",
    ...reviewedTechnicalMessages["zh-Hans"],
  },
  en: {
    "選擇語言": "Select language", "CryptoBot Labs｜自動交易策略實驗室": "CryptoBot Labs | Automated Trading Strategy Lab", "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。": "Explore, build, and share automated trading strategies. Backtest with public historical data and run simulations before safely preparing cloud execution.", "CryptoBot Labs：簡單點選，實現自動化策略": "CryptoBot Labs: Build automated strategies with simple clicks", "繁體中文": "Traditional Chinese", "探索策略": "Explore strategies", "組裝策略": "Build a strategy", "排行榜": "Leaderboard", "我的運行": "My runs", "控制台": "Console",
    "跳至主要內容": "Skip to main content", "主要導覽": "Main navigation", "行動版導覽": "Mobile navigation", "關閉導覽選單": "Close navigation menu", "開啟導覽選單": "Open navigation menu",
    "交易連線": "Exchange connections", "展示後台": "Demo admin", "登入": "Sign in", "登出": "Sign out", "自動策略實驗室": "Automated strategy lab", "回測資料揭露": "Backtest disclosure",
    "回測結果，不代表未來績效": "Backtest results do not guarantee future performance", "公開績效皆為歷史回測或模擬研究資料；本項目不保證資料即時性、完整性或未來結果。": "Published performance consists of historical backtests or simulated research. This project does not guarantee timeliness, completeness, or future results.",
    "法律與風險資訊": "Legal and risk information", "使用條款、隱私與風險": "Terms, privacy, and risk", "三步驟開始使用": "Get started in three steps", "三步，從想法到自動實現": "Three steps from idea to automation",
    "挑選": "Pick", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。": "Find a strategy starting point across spot, futures, and different risk levels.", "組裝": "Build", "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。": "Combine conditions and risk controls, backtest them on public market history, then decide whether to run.",
    "自動運行": "Automate", "通過回測與設置後，準備開始自動運行": "After backtesting and setup, get ready to run automatically.", "自由組裝各種策略": "Build strategies your way", "把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。": "Combine entries, confirmations, exits, sizing, and risk controls with clicks to bring your trading idea to life.",
    "進入組裝車間": "Open the workshop", "支援匯入交易策略代碼": "Import strategy code", "支持使用自行編寫的交易策略，幫助你開啟更多可能性": "Use your own strategy code to unlock more possibilities.", "開啟 JavaScript 模式": "Open JavaScript mode",
    "選擇策略範本，或是由你從零開始組裝": "Choose a strategy template or build one from scratch", "先選一個策略": "Choose a strategy", "從空白開始": "Start from scratch",
    ...reviewedTechnicalMessages.en,
  },
  ar: {
    "選擇語言": "اختيار اللغة", "CryptoBot Labs｜自動交易策略實驗室": "CryptoBot Labs | مختبر استراتيجيات التداول الآلي", "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。": "استكشف استراتيجيات التداول الآلي وأنشئها وشاركها. اختبرها على بيانات تاريخية عامة وشغّل المحاكاة قبل إعداد التنفيذ السحابي بأمان.", "CryptoBot Labs：簡單點選，實現自動化策略": "CryptoBot Labs: أنشئ استراتيجيات آلية بنقرات بسيطة", "繁體中文": "الصينية التقليدية", "探索策略": "استكشاف الاستراتيجيات", "組裝策略": "بناء استراتيجية", "排行榜": "لوحة المتصدرين", "我的運行": "عملياتي", "控制台": "لوحة التحكم",
    "跳至主要內容": "الانتقال إلى المحتوى الرئيسي", "主要導覽": "التنقل الرئيسي", "行動版導覽": "تنقل الهاتف", "關閉導覽選單": "إغلاق قائمة التنقل", "開啟導覽選單": "فتح قائمة التنقل",
    "交易連線": "اتصالات المنصة", "展示後台": "إدارة العرض", "登入": "تسجيل الدخول", "登出": "تسجيل الخروج", "自動策略實驗室": "مختبر الاستراتيجيات الآلية", "回測資料揭露": "إفصاح الاختبار التاريخي",
    "回測結果，不代表未來績效": "نتائج الاختبار التاريخي لا تضمن الأداء المستقبلي", "公開績效皆為歷史回測或模擬研究資料；本項目不保證資料即時性、完整性或未來結果。": "الأداء المنشور ناتج عن اختبارات تاريخية أو أبحاث محاكاة. لا يضمن هذا المشروع حداثة البيانات أو اكتمالها أو النتائج المستقبلية.",
    "法律與風險資訊": "المعلومات القانونية ومعلومات المخاطر", "使用條款、隱私與風險": "الشروط والخصوصية والمخاطر", "三步驟開始使用": "ابدأ في ثلاث خطوات", "三步，從想法到自動實現": "ثلاث خطوات من الفكرة إلى الأتمتة",
    "挑選": "اختر", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。": "اعثر على نقطة بداية لاستراتيجيتك بين التداول الفوري والعقود ومستويات المخاطر المختلفة.", "組裝": "ابنِ", "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。": "اجمع الشروط وضوابط المخاطر واختبرها على بيانات السوق التاريخية العامة قبل التشغيل.",
    "自動運行": "شغّل آليًا", "通過回測與設置後，準備開始自動運行": "بعد الاختبار والإعداد، استعد للتشغيل الآلي.", "自由組裝各種策略": "أنشئ استراتيجيات بطريقتك", "把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。": "اجمع قواعد الدخول والتأكيد والخروج وحجم الصفقة وإدارة المخاطر بنقرات بسيطة.",
    "進入組裝車間": "فتح ورشة البناء", "支援匯入交易策略代碼": "استيراد رمز الاستراتيجية", "支持使用自行編寫的交易策略，幫助你開啟更多可能性": "استخدم رمز استراتيجيتك لفتح مزيد من الإمكانات.", "開啟 JavaScript 模式": "فتح وضع JavaScript",
    "選擇策略範本，或是由你從零開始組裝": "اختر قالب استراتيجية أو ابدأ من الصفر", "先選一個策略": "اختر استراتيجية", "從空白開始": "ابدأ من الصفر",
    ...reviewedTechnicalMessages.ar,
  },
  ru: {
    "選擇語言": "Выбрать язык", "CryptoBot Labs｜自動交易策略實驗室": "CryptoBot Labs | Лаборатория автоматических торговых стратегий", "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。": "Изучайте, создавайте и делитесь автоматическими торговыми стратегиями. Проверяйте их на открытых исторических данных и запускайте симуляции перед безопасной подготовкой облачного исполнения.", "CryptoBot Labs：簡單點選，實現自動化策略": "CryptoBot Labs: создавайте автоматические стратегии несколькими нажатиями", "繁體中文": "Традиционный китайский", "探索策略": "Обзор стратегий", "組裝策略": "Создать стратегию", "排行榜": "Рейтинг", "我的運行": "Мои запуски", "控制台": "Консоль",
    "跳至主要內容": "Перейти к основному содержимому", "主要導覽": "Основная навигация", "行動版導覽": "Мобильная навигация", "關閉導覽選單": "Закрыть меню навигации", "開啟導覽選單": "Открыть меню навигации",
    "交易連線": "Подключения к бирже", "展示後台": "Демо-панель", "登入": "Войти", "登出": "Выйти", "自動策略實驗室": "Лаборатория автоматических стратегий", "回測資料揭露": "Раскрытие данных бэктеста",
    "回測結果，不代表未來績效": "Результаты бэктеста не гарантируют будущую доходность", "公開績效皆為歷史回測或模擬研究資料；本項目不保證資料即時性、完整性或未來結果。": "Опубликованные результаты основаны на исторических бэктестах или симуляциях. Проект не гарантирует актуальность, полноту данных или будущие результаты.",
    "法律與風險資訊": "Юридическая информация и риски", "使用條款、隱私與風險": "Условия, конфиденциальность и риски", "三步驟開始使用": "Начните за три шага", "三步，從想法到自動實現": "Три шага от идеи до автоматизации",
    "挑選": "Выберите", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。": "Найдите основу стратегии среди спота, фьючерсов и разных уровней риска.", "組裝": "Соберите", "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。": "Соберите условия и контроль риска, проверьте их на открытых исторических данных и затем решите, запускать ли стратегию.",
    "自動運行": "Автоматизируйте", "通過回測與設置後，準備開始自動運行": "После бэктеста и настройки подготовьте автоматический запуск.", "自由組裝各種策略": "Создавайте стратегии по-своему", "把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。": "Комбинируйте входы, подтверждения, выходы, размер позиции и риск-контроль несколькими нажатиями.",
    "進入組裝車間": "Открыть мастерскую", "支援匯入交易策略代碼": "Импорт кода стратегии", "支持使用自行編寫的交易策略，幫助你開啟更多可能性": "Используйте собственный код стратегии, чтобы открыть больше возможностей.", "開啟 JavaScript 模式": "Открыть режим JavaScript",
    "選擇策略範本，或是由你從零開始組裝": "Выберите шаблон стратегии или начните с нуля", "先選一個策略": "Выбрать стратегию", "從空白開始": "Начать с нуля",
    ...reviewedTechnicalMessages.ru,
  },
  ja: {
    "選擇語言": "言語を選択", "CryptoBot Labs｜自動交易策略實驗室": "CryptoBot Labs｜自動売買戦略ラボ", "探索、組裝與分享自動交易策略；先用公開歷史資料回測與模擬運行，再安全準備雲端執行。": "自動売買戦略を探し、組み立て、共有できます。公開された過去データでバックテストとシミュレーションを行ってから、安全にクラウド実行を準備します。", "CryptoBot Labs：簡單點選，實現自動化策略": "CryptoBot Labs：クリック操作で自動化戦略を実現", "繁體中文": "繁体字中国語", "探索策略": "戦略を探す", "組裝策略": "戦略を組み立てる", "排行榜": "ランキング", "我的運行": "マイ運用", "控制台": "コンソール",
    "跳至主要內容": "メインコンテンツへ移動", "主要導覽": "メインナビゲーション", "行動版導覽": "モバイルナビゲーション", "關閉導覽選單": "ナビゲーションメニューを閉じる", "開啟導覽選單": "ナビゲーションメニューを開く",
    "交易連線": "取引所接続", "展示後台": "デモ管理", "登入": "ログイン", "登出": "ログアウト", "自動策略實驗室": "自動戦略ラボ", "回測資料揭露": "バックテスト情報の開示",
    "回測結果，不代表未來績效": "バックテスト結果は将来の運用成績を保証しません", "公開績效皆為歷史回測或模擬研究資料；本項目不保證資料即時性、完整性或未來結果。": "公開されている成績は、過去データによるバックテストまたはシミュレーション研究です。本プロジェクトは、データの即時性、完全性、将来の結果を保証しません。",
    "法律與風險資訊": "法務・リスク情報", "使用條款、隱私與風險": "利用規約、プライバシー、リスク", "三步驟開始使用": "3ステップで始める", "三步，從想法到自動實現": "アイデアから自動化までの3ステップ",
    "挑選": "選ぶ", "從現貨、合約與不同風險等級中，找到符合想法的策略起點。": "現物、先物、さまざまなリスク水準から、アイデアに合う戦略の出発点を見つけます。", "組裝": "組み立てる", "組裝條件與風控，先用公開歷史行情回測，再決定是否運行。": "条件とリスク管理を組み合わせ、公開された過去の相場データで検証してから運用を決めます。",
    "自動運行": "自動運用", "通過回測與設置後，準備開始自動運行": "バックテストと設定を完了し、自動運用を開始する準備をします。", "自由組裝各種策略": "自由に戦略を組み立てる", "把進場、確認、出場、倉位與風控用點擊組合的方式，簡單實現你的交易想法。": "エントリー、確認、決済、ポジション量、リスク管理をクリックで組み合わせ、取引アイデアを形にします。",
    "進入組裝車間": "組み立てワークショップへ", "支援匯入交易策略代碼": "戦略コードをインポート", "支持使用自行編寫的交易策略，幫助你開啟更多可能性": "独自の戦略コードを使って、可能性をさらに広げられます。", "開啟 JavaScript 模式": "JavaScript モードを開く",
    "選擇策略範本，或是由你從零開始組裝": "戦略テンプレートを選ぶか、ゼロから組み立てる", "先選一個策略": "戦略を選ぶ", "從空白開始": "ゼロから始める",
    ...reviewedTechnicalMessages.ja,
  },
} as const satisfies Record<Locale, Record<string, string>>;

const generatedMessages: Record<Locale, Record<string, string>> = {
  "zh-Hant": generatedZhHant,
  "zh-Hans": generatedZhHans,
  en: generatedEn,
  ar: generatedAr,
  ru: generatedRu,
  ja: generatedJa,
};

export const messages: Record<Locale, Record<string, string>> = {
  "zh-Hant": { ...generatedMessages["zh-Hant"], ...reviewedMessages["zh-Hant"] },
  "zh-Hans": { ...generatedMessages["zh-Hans"], ...reviewedMessages["zh-Hans"] },
  en: { ...generatedMessages.en, ...reviewedMessages.en },
  ar: { ...generatedMessages.ar, ...reviewedMessages.ar },
  ru: { ...generatedMessages.ru, ...reviewedMessages.ru },
  ja: { ...generatedMessages.ja, ...reviewedMessages.ja },
};

let sourceByTranslation: Map<string, string> | null = null;
let sourcePatternsByTranslation: Array<{
  pattern: RegExp;
  placeholderOrder: number[];
  source: string;
}> | null = null;

/** Resolve server-rendered metadata in any supported locale back to its
 * canonical source before applying a new client-side locale. */
export function canonicalMessageSource(value: string): string {
  if (!sourceByTranslation) {
    sourceByTranslation = new Map<string, string>();
    sourcePatternsByTranslation = [];
    for (const locale of Object.keys(messages) as Locale[]) {
      for (const [source, translation] of Object.entries(messages[locale])) {
        if (!sourceByTranslation.has(translation)) sourceByTranslation.set(translation, source);
        if (!/__\d+__/u.test(translation)
          || translation.replace(/__\d+__/gu, "").trim().length === 0) continue;
        const placeholderOrder: number[] = [];
        const parts: string[] = [];
        let cursor = 0;
        for (const match of translation.matchAll(/__(\d+)__/gu)) {
          parts.push(translation.slice(cursor, match.index).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
          parts.push("(.+?)");
          placeholderOrder.push(Number(match[1]));
          cursor = (match.index ?? 0) + match[0].length;
        }
        parts.push(translation.slice(cursor).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
        sourcePatternsByTranslation.push({ pattern: new RegExp(`^${parts.join("")}$`, "u"), placeholderOrder, source });
      }
    }
    sourcePatternsByTranslation.sort((left, right) => right.pattern.source.length - left.pattern.source.length);
  }
  const exact = sourceByTranslation.get(value);
  if (exact) return exact;
  for (const { pattern, placeholderOrder, source } of sourcePatternsByTranslation ?? []) {
    const match = value.match(pattern);
    if (!match) continue;
    const captures = new Map(placeholderOrder.map((placeholder, index) => {
      const capture = match[index + 1] ?? "";
      return [placeholder, capture === value ? capture : canonicalMessageSource(capture)];
    }));
    return source.replace(/__(\d+)__/gu, (_, index) => captures.get(Number(index)) ?? "");
  }
  return value;
}

type PatternTranslation = { pattern: RegExp; translated: string };
const patternCache = new Map<Locale, PatternTranslation[]>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function localePatterns(locale: Locale): PatternTranslation[] {
  const cached = patternCache.get(locale);
  if (cached) return cached;
  const patterns = Object.entries(messages[locale])
    .filter(([source]) => /__\d+__/u.test(source))
    .map(([source, translated]) => ({
      pattern: new RegExp(`^${source.split(/__\d+__/gu).map(escapeRegExp).join("(.+?)")}$`, "u"),
      translated,
    }))
    .sort((left, right) => right.pattern.source.length - left.pattern.source.length);
  patternCache.set(locale, patterns);
  return patterns;
}

export function translateMessage(locale: Locale, source: string): string {
  const exact = messages[locale][source];
  if (exact) return exact;

  for (const { pattern, translated } of localePatterns(locale)) {
    const match = source.match(pattern);
    if (!match) continue;
    return translated.replace(/__(\d+)__/gu, (_, index) => {
      const captured = match[Number(index) + 1] ?? "";
      return translateMessage(locale, captured);
    });
  }
  return source;
}
