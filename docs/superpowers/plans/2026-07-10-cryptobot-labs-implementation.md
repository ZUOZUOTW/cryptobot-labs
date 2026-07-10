# CryptoBot Labs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a polished, responsive, multi-route CryptoBot Labs prototype where users can explore 10 simulated WEEX-only bots, combine strategies, adjust parameters, run deterministic backtests, and download or re-import complete strategy packages.

**Architecture:** Use the Sites vinext React/TypeScript starter with file-based routes. Keep domain contracts, fixed bot data, deterministic backtesting, validation, and ZIP package serialization in pure modules; pages consume those modules through focused components. Store only local drafts and preferences in browser storage, never execute pasted JavaScript, and never call a trading endpoint.

**Tech Stack:** React, TypeScript, vinext/Vite, Vitest, Testing Library, JSZip, CSS custom properties and keyframe animation, browser `localStorage` and File APIs.

## Global Constraints

- The product name is exactly `CryptoBot Labs`.
- The interface language is Traditional Chinese.
- The visual direction is Orbital Lab: graphite black, electric violet, ice blue, mint success, orange-red warning.
- The first version is a high-fidelity simulation prototype; it must not accept API keys, query accounts, or place orders.
- Every exchange field must be exactly `WEEX`; any other exchange identifier blocks backtesting and export.
- Every performance surface must state `模擬回測資料，不代表未來績效`.
- Provide exactly 10 built-in bots: five spot and five USDT-M futures strategies.
- Quick assembly must support multiple strategy blocks, AND/OR logic, parameter adjustment, risk controls, deterministic backtests, and plain-language summaries.
- JavaScript mode may validate and summarize source but must never execute it with `eval`, `Function`, a script element, a worker, or a server runtime.
- Downloads must be ZIP files containing `bot-config.json`, `strategy.js`, `backtest-report.json`, `README-zh-TW.md`, and `manifest.json`.
- Downloaded packages must be importable back into the workshop.
- Support keyboard operation, touch interaction, responsive layouts, and `prefers-reduced-motion`.
- Preserve the Sites starter architecture, `.openai/hosting.json`, package manager, and Cloudflare Worker-compatible output.

---

## File Structure

```text
app/
  layout.tsx                    Site metadata and shared shell
  page.tsx                      Orbital Lab landing page
  globals.css                   Tokens, layout, motion, responsive rules
  bots/page.tsx                 Bot catalog route
  bots/[id]/page.tsx            Bot detail route
  leaderboard/page.tsx          Animated ranking route
  workshop/page.tsx             Strategy builder route
components/
  SiteHeader.tsx                Shared navigation and mobile menu
  SiteFooter.tsx                WEEX-only and simulation disclosures
  OrbitalHero.tsx               Landing hero visual and motion
  BotCard.tsx                   Catalog and featured-bot card
  PerformanceChart.tsx          Accessible deterministic chart
  MetricCard.tsx                Metric label/value/disclosure unit
  LeaderboardTable.tsx          Sortable, animated rank comparison
  workshop/StrategyPalette.tsx  Searchable multi-select strategy blocks
  workshop/ParameterPanel.tsx   Beginner-friendly parameter controls
  workshop/StrategySummary.tsx  Natural-language strategy explanation
  workshop/BacktestPanel.tsx    Run state, chart, and metrics
  workshop/JavaScriptEditor.tsx Source input and static validation
  workshop/PackagePanel.tsx     Export and import workflow
data/bots.ts                    Exactly 10 built-in bot definitions
data/strategies.ts              Strategy block catalog and presets
lib/types.ts                    Shared domain types
lib/backtest.ts                 Seeded simulation and metric calculation
lib/strategy-validation.ts      Builder and JavaScript safety validation
lib/strategy-summary.ts         Traditional Chinese summary generation
lib/bot-package.ts              ZIP export and import
lib/storage.ts                  Safe local-draft adapter
tests/
  bots.test.ts
  backtest.test.ts
  strategy-validation.test.ts
  strategy-summary.test.ts
  bot-package.test.ts
  workshop-flow.test.tsx
  navigation.test.tsx
  setup.ts
vitest.config.ts
public/og.png                   Finished site-specific social preview
```

---

### Task 1: Scaffold the Sites App and Lock the Domain Contracts

**Files:**
- Create through initializer: `package.json`, `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `.openai/hosting.json`
- Create: `lib/types.ts`
- Create: `data/bots.ts`
- Create: `tests/bots.test.ts`
- Create: `tests/setup.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `Bot`, `BotMetrics`, `EquityPoint`, `StrategyBlock`, `BotConfig`, `BacktestReport`, and `BOT_CATALOG`.
- `BOT_CATALOG` is consumed by every route and by package generation.

- [ ] **Step 1: Initialize the empty workspace once**

Run the Sites initializer with the project root, retain the installation session, then start the development server and open the exact local URL once. Do not run a second initializer.

Expected: the starter loading page is visible and `.openai/hosting.json` exists.

- [ ] **Step 2: Add test and package dependencies**

Run:

```bash
pnpm add jszip
pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 3: Write the failing catalog test**

Create `tests/bots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_CATALOG } from "../data/bots";

describe("BOT_CATALOG", () => {
  it("contains five spot and five futures WEEX bots with unique ids", () => {
    expect(BOT_CATALOG).toHaveLength(10);
    expect(BOT_CATALOG.filter((bot) => bot.market === "spot")).toHaveLength(5);
    expect(BOT_CATALOG.filter((bot) => bot.market === "futures")).toHaveLength(5);
    expect(new Set(BOT_CATALOG.map((bot) => bot.id)).size).toBe(10);
    expect(BOT_CATALOG.every((bot) => bot.exchange === "WEEX")).toBe(true);
  });

  it("provides complete metrics and at least twelve equity points", () => {
    for (const bot of BOT_CATALOG) {
      expect(bot.equityCurve.length).toBeGreaterThanOrEqual(12);
      expect(bot.metrics.maxDrawdown).toBeLessThanOrEqual(0);
      expect(bot.metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(bot.metrics.winRate).toBeLessThanOrEqual(100);
      expect(bot.disclaimer).toBe("模擬回測資料，不代表未來績效");
    }
  });
});
```

- [ ] **Step 4: Run the test and verify the missing-module failure**

Run: `pnpm test -- tests/bots.test.ts`

Expected: FAIL because `data/bots.ts` does not exist.

- [ ] **Step 5: Define the domain contracts**

Create `lib/types.ts` with these exact exported contracts:

```ts
export type Market = "spot" | "futures";
export type RiskLevel = "低" | "中" | "高";
export type StrategyGroup = "entry" | "confirm" | "exit" | "position" | "risk";
export type LogicMode = "all" | "any";

export interface EquityPoint { label: string; value: number }
export interface BotMetrics {
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  winRate: number;
  profitFactor: number;
  sharpe: number;
  trades: number;
  runningDays: number;
  stability: number;
}
export interface StrategyParameter {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}
export interface StrategyBlock {
  id: string;
  name: string;
  group: StrategyGroup;
  description: string;
  parameters: StrategyParameter[];
}
export interface BotConfig {
  id: string;
  name: string;
  exchange: "WEEX";
  market: Market;
  symbol: string;
  timeframe: string;
  logicMode: LogicMode;
  leverage: number;
  blocks: StrategyBlock[];
  source?: string;
}
export interface BacktestReport {
  seed: string;
  generatedAt: string;
  metrics: BotMetrics;
  equityCurve: EquityPoint[];
  disclaimer: "模擬回測資料，不代表未來績效";
}
export interface BotDefinition extends BotConfig {
  description: string;
  tags: string[];
  risk: RiskLevel;
  metrics: BotMetrics;
  equityCurve: EquityPoint[];
  explanation: string;
  suitableFor: string;
  riskNote: string;
  disclaimer: "模擬回測資料，不代表未來績效";
}
```

- [ ] **Step 6: Implement the complete bot catalog**

Create `data/bots.ts`. Define a `makeBot` helper that derives monthly equity points from a numeric array, then instantiate exactly these bots and no extras:

```ts
import type { BotDefinition, Market, RiskLevel } from "../lib/types";

const DISCLAIMER = "模擬回測資料，不代表未來績效" as const;
const months = ["7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月", "4月", "5月", "6月"];
const makeCurve = (values: number[]) => values.map((value, index) => ({ label: months[index], value }));

type Seed = {
  id: string; name: string; market: Market; description: string; tags: string[];
  risk: RiskLevel; totalReturn: number; drawdown: number; winRate: number;
  sharpe: number; trades: number; stability: number; curve: number[];
  explanation: string; suitableFor: string; riskNote: string;
};

const makeBot = (seed: Seed): BotDefinition => ({
  id: seed.id,
  name: seed.name,
  exchange: "WEEX",
  market: seed.market,
  symbol: "BTCUSDT",
  timeframe: seed.market === "spot" ? "4h" : "1h",
  logicMode: "all",
  leverage: seed.market === "spot" ? 1 : 3,
  blocks: [],
  description: seed.description,
  tags: seed.tags,
  risk: seed.risk,
  metrics: {
    totalReturn: seed.totalReturn,
    annualizedReturn: Number((seed.totalReturn * 0.72).toFixed(1)),
    maxDrawdown: seed.drawdown,
    winRate: seed.winRate,
    profitFactor: Number((1.25 + seed.winRate / 100).toFixed(2)),
    sharpe: seed.sharpe,
    trades: seed.trades,
    runningDays: 365,
    stability: seed.stability,
  },
  equityCurve: makeCurve(seed.curve),
  explanation: seed.explanation,
  suitableFor: seed.suitableFor,
  riskNote: seed.riskNote,
  disclaimer: DISCLAIMER,
});

export const BOT_CATALOG: BotDefinition[] = [
  makeBot({ id:"orbit-dca", name:"Orbit DCA", market:"spot", description:"回撤時分批加碼的穩健定投策略", tags:["定投","回撤加碼"], risk:"低", totalReturn:48.6, drawdown:-12.4, winRate:64.2, sharpe:1.42, trades:82, stability:91, curve:[100,103,106,104,111,115,119,123,128,134,141,148.6], explanation:"依固定週期投入，價格回撤時提高投入比例。", suitableFor:"長期累積與低頻操作", riskNote:"單邊下跌時仍可能持續承受浮虧。" }),
  makeBot({ id:"grid-navigator", name:"Grid Navigator", market:"spot", description:"在震盪區間自動低買高賣", tags:["網格","震盪"], risk:"中", totalReturn:72.3, drawdown:-18.8, winRate:71.4, sharpe:1.67, trades:246, stability:86, curve:[100,108,105,116,122,118,131,139,145,151,163,172.3], explanation:"以價格區間建立多層買賣網格。", suitableFor:"橫盤與高流動性市場", riskNote:"突破網格區間時可能累積單向部位。" }),
  makeBot({ id:"golden-cross", name:"Golden Cross", market:"spot", description:"以長短均線掌握中期趨勢", tags:["均線","趨勢"], risk:"中", totalReturn:83.7, drawdown:-21.5, winRate:55.8, sharpe:1.51, trades:64, stability:82, curve:[100,98,107,114,109,126,139,132,149,158,174,183.7], explanation:"短均線上穿長均線時進場，反向交叉時離場。", suitableFor:"具有明確方向的波段行情", riskNote:"盤整期容易出現連續假訊號。" }),
  makeBot({ id:"rsi-rebound", name:"RSI Rebound", market:"spot", description:"捕捉超賣後的價格回彈", tags:["RSI","反轉"], risk:"中", totalReturn:61.9, drawdown:-16.1, winRate:67.9, sharpe:1.59, trades:118, stability:84, curve:[100,104,112,109,119,126,124,136,142,151,147,161.9], explanation:"RSI 進入超賣區並重新回升時分批進場。", suitableFor:"震盪或溫和多頭市場", riskNote:"強勢下跌時超賣狀態可能長時間持續。" }),
  makeBot({ id:"bollinger-pulse", name:"Bollinger Pulse", market:"spot", description:"追蹤波動壓縮後的方向突破", tags:["布林通道","突破"], risk:"中", totalReturn:91.2, drawdown:-23.2, winRate:52.1, sharpe:1.63, trades:76, stability:79, curve:[100,96,109,121,117,135,148,141,159,172,168,191.2], explanation:"通道收窄後，價格帶量突破上軌時進場。", suitableFor:"波動由低轉高的市場", riskNote:"假突破可能造成快速停損。" }),
  makeBot({ id:"momentum-forge", name:"Momentum Forge", market:"futures", description:"MACD 動能確認後順勢進場", tags:["MACD","動能"], risk:"高", totalReturn:126.4, drawdown:-31.8, winRate:58.6, sharpe:1.82, trades:154, stability:75, curve:[100,112,106,129,145,137,166,181,173,198,211,226.4], explanation:"以 MACD 柱體擴張與趨勢方向共同確認。", suitableFor:"有延續性的快速趨勢", riskNote:"槓桿會同時放大收益與損失。" }),
  makeBot({ id:"breakout-hunter", name:"Breakout Hunter", market:"futures", description:"區間突破後追蹤多空趨勢", tags:["突破","多空"], risk:"高", totalReturn:142.8, drawdown:-36.4, winRate:49.7, sharpe:1.74, trades:132, stability:69, curve:[100,91,118,137,129,159,151,186,176,205,224,242.8], explanation:"突破近期高低點後依方向建立部位。", suitableFor:"波動擴張與事件行情", riskNote:"跳空與假突破會增加滑價風險。" }),
  makeBot({ id:"atr-sentinel", name:"ATR Sentinel", market:"futures", description:"用波動率調整倉位與移動停損", tags:["ATR","移動停損"], risk:"中", totalReturn:108.5, drawdown:-24.7, winRate:54.9, sharpe:1.91, trades:103, stability:83, curve:[100,107,115,111,126,139,145,152,166,179,193,208.5], explanation:"依 ATR 設定倉位大小與移動停損距離。", suitableFor:"波動快速改變的趨勢市場", riskNote:"波動突然放大時仍可能超出預期停損。" }),
  makeBot({ id:"dual-side-ranger", name:"Dual-Side Ranger", market:"futures", description:"在定義區間內管理多空雙向部位", tags:["雙向","區間"], risk:"高", totalReturn:118.9, drawdown:-34.2, winRate:66.1, sharpe:1.55, trades:286, stability:71, curve:[100,114,109,126,121,143,158,151,177,189,203,218.9], explanation:"以區間中線與邊界管理多空進出。", suitableFor:"高流動性震盪市場", riskNote:"趨勢突破時雙向部位可能快速失衡。" }),
  makeBot({ id:"leverage-guardian", name:"Leverage Guardian", market:"futures", description:"低槓桿與嚴格回撤控制組合", tags:["低槓桿","風控"], risk:"中", totalReturn:86.6, drawdown:-17.9, winRate:61.3, sharpe:2.04, trades:94, stability:90, curve:[100,105,111,108,119,127,134,142,149,161,174,186.6], explanation:"限制槓桿、單筆風險與每日最大損失。", suitableFor:"重視風險調整報酬的使用者", riskNote:"風控會在快速反彈前提早退出部位。" }),
];
```

- [ ] **Step 7: Configure and run tests**

Create `vitest.config.ts` with `environment: "jsdom"`, `setupFiles: ["./tests/setup.ts"]`, and include `tests/**/*.test.{ts,tsx}`. Import `@testing-library/jest-dom/vitest` from `tests/setup.ts`.

Run: `pnpm test -- tests/bots.test.ts`

Expected: 2 tests PASS.

- [ ] **Step 8: Commit the foundation**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts tests/setup.ts tests/bots.test.ts lib/types.ts data/bots.ts app .openai/hosting.json
git commit -m "feat: scaffold CryptoBot Labs domain foundation"
```

---

### Task 2: Implement Strategy Catalog, Validation, Summary, and Deterministic Backtesting

**Files:**
- Create: `data/strategies.ts`
- Create: `lib/strategy-validation.ts`
- Create: `lib/strategy-summary.ts`
- Create: `lib/backtest.ts`
- Create: `tests/strategy-validation.test.ts`
- Create: `tests/strategy-summary.test.ts`
- Create: `tests/backtest.test.ts`

**Interfaces:**
- Produces: `STRATEGY_BLOCKS`, `STRATEGY_PRESETS`, `validateConfig(config): ValidationResult`, `validateJavaScript(source): SourceValidationResult`, `summarizeStrategy(config): string[]`, and `runBacktest(config): BacktestReport`.
- Consumes: domain types from `lib/types.ts`.

- [ ] **Step 1: Write failing validation and summary tests**

Test these exact behaviors:

```ts
expect(validateConfig(validConfig).valid).toBe(true);
expect(validateConfig({ ...validConfig, exchange: "BINANCE" as "WEEX" }).errors).toContain("只支援 WEEX 交易所");
expect(validateConfig({ ...validConfig, blocks: [] }).errors).toContain("至少需要一個進場訊號");
expect(validateJavaScript("fetch('https://api.binance.com')").valid).toBe(false);
expect(validateJavaScript("const exchange = 'WEEX';").valid).toBe(true);
expect(summarizeStrategy(validConfig).join(" ")).toContain("RSI");
```

Run: `pnpm test -- tests/strategy-validation.test.ts tests/strategy-summary.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 2: Add the strategy blocks and presets**

In `data/strategies.ts`, export blocks for RSI, MACD, SMA cross, Bollinger breakout, grid, DCA, volume confirmation, take profit, stop loss, trailing stop, fixed position, ATR sizing, and maximum daily loss. Every block must have concrete min/max/default parameter metadata. Export five preset configs named `穩健趨勢`, `震盪低買高賣`, `突破追蹤`, `定投與回撤加碼`, and `低槓桿風控`.

- [ ] **Step 3: Implement exact validation rules**

In `lib/strategy-validation.ts`:

```ts
const FORBIDDEN = ["binance", "okx", "bybit", "coinbase", "kraken", "api.binance.com", "api.bybit.com"];

export const validateJavaScript = (source: string) => {
  const lowered = source.toLowerCase();
  const forbidden = FORBIDDEN.find((token) => lowered.includes(token));
  const errors: string[] = [];
  if (forbidden) errors.push(`偵測到非 WEEX 交易所識別字：${forbidden}`);
  const pairs = [["(", ")"], ["{", "}"], ["[", "]"]] as const;
  for (const [open, close] of pairs) {
    if ((source.split(open).length - 1) !== (source.split(close).length - 1)) errors.push(`括號不完整：${open}${close}`);
  }
  return { valid: errors.length === 0, errors };
};
```

`validateConfig` must require `exchange === "WEEX"`, at least one `entry` block, at least one `exit` or `risk` block, leverage `1` for spot and `1..20` for futures, parameter values within min/max, and a valid JavaScript source when present.

- [ ] **Step 4: Implement the Traditional Chinese summary**

`summarizeStrategy` must map block IDs to full sentences, include timeframe, logic mode, position size, leverage, stop loss, and take profit, and return an array so the UI can render one sentence per rule.

- [ ] **Step 5: Write the failing deterministic backtest test**

```ts
it("returns identical curves and metrics for identical configs", () => {
  expect(runBacktest(validConfig)).toEqual(runBacktest(validConfig));
});

it("changes the result when leverage changes", () => {
  expect(runBacktest(validConfig).metrics.totalReturn)
    .not.toBe(runBacktest({ ...validConfig, leverage: 5 }).metrics.totalReturn);
});

it("always returns 36 points and bounded metrics", () => {
  const report = runBacktest(validConfig);
  expect(report.equityCurve).toHaveLength(36);
  expect(report.metrics.maxDrawdown).toBeLessThanOrEqual(0);
  expect(report.disclaimer).toBe("模擬回測資料，不代表未來績效");
});
```

- [ ] **Step 6: Implement seeded simulation**

Use a string hash of the stable JSON representation of the config as the PRNG seed. Generate 36 monthly points from strategy count, risk-block count, and leverage. Derive cumulative return, annualized return, peak-to-trough maximum drawdown, win rate, profit factor, Sharpe, trade count, running days, and stability from the generated returns. Use a fixed `generatedAt` derived from the seed so repeated calls are deeply equal.

- [ ] **Step 7: Run all domain tests**

Run: `pnpm test -- tests/bots.test.ts tests/strategy-validation.test.ts tests/strategy-summary.test.ts tests/backtest.test.ts`

Expected: all tests PASS and repeated runs are identical.

- [ ] **Step 8: Commit the strategy engine**

```bash
git add data/strategies.ts lib/strategy-validation.ts lib/strategy-summary.ts lib/backtest.ts tests
git commit -m "feat: add deterministic WEEX strategy engine"
```

---

### Task 3: Implement Safe Local Storage and ZIP Package Round-Trip

**Files:**
- Create: `lib/storage.ts`
- Create: `lib/bot-package.ts`
- Create: `tests/bot-package.test.ts`

**Interfaces:**
- Produces: `saveDraft`, `loadDraft`, `exportBotPackage(config, report): Promise<Blob>`, and `importBotPackage(file): Promise<{ config: BotConfig; report: BacktestReport }>`.
- Consumes: `validateConfig` and domain types.

- [ ] **Step 1: Write the failing ZIP round-trip test**

```ts
it("exports all five required files and re-imports the same WEEX config", async () => {
  const blob = await exportBotPackage(validConfig, runBacktest(validConfig));
  const zip = await JSZip.loadAsync(blob);
  expect(Object.keys(zip.files).sort()).toEqual([
    "README-zh-TW.md", "backtest-report.json", "bot-config.json", "manifest.json", "strategy.js"
  ]);
  const imported = await importBotPackage(new File([blob], "bot.zip"));
  expect(imported.config).toEqual(validConfig);
});

it("rejects a package whose manifest does not declare WEEX", async () => {
  await expect(importBotPackage(nonWeexFile)).rejects.toThrow("只支援 WEEX 交易所");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm test -- tests/bot-package.test.ts`

Expected: FAIL because `lib/bot-package.ts` does not exist.

- [ ] **Step 3: Implement export and import**

`exportBotPackage` must validate first, create the five required files with JSZip, set `manifest.exchange` to `WEEX`, include `formatVersion: 1`, and return `zip.generateAsync({ type: "blob" })`. The generated README must say the package is a simulation prototype and cannot independently execute real trades. `importBotPackage` must reject missing files, unsupported versions, invalid JSON, non-WEEX manifests, and invalid configs with specific Traditional Chinese messages.

- [ ] **Step 4: Implement resilient local draft storage**

`saveDraft` returns `{ ok: true }` or `{ ok: false, reason: string }` instead of throwing. `loadDraft` returns `null` for missing or malformed storage. Use the fixed key `cryptobot-labs:draft:v1`.

- [ ] **Step 5: Run the package tests**

Run: `pnpm test -- tests/bot-package.test.ts`

Expected: all tests PASS, including file-name and WEEX validation.

- [ ] **Step 6: Commit package support**

```bash
git add lib/storage.ts lib/bot-package.ts tests/bot-package.test.ts
git commit -m "feat: add downloadable bot strategy packages"
```

---

### Task 4: Build the Orbital Lab Shell and Shared Visual Components

**Files:**
- Modify: `app/layout.tsx`
- Replace: `app/globals.css`
- Create: `components/SiteHeader.tsx`
- Create: `components/SiteFooter.tsx`
- Create: `components/PerformanceChart.tsx`
- Create: `components/MetricCard.tsx`
- Create: `tests/navigation.test.tsx`
- Remove: `app/_sites-preview/**` and its imports

**Interfaces:**
- Produces shared page shell, navigation, disclosure footer, chart, and metric components.
- Consumes `EquityPoint` and the global simulation disclosure.

- [ ] **Step 1: Write the failing navigation test**

Render `SiteHeader` and assert links named `機器人`, `排行榜`, and `組裝車間` point to `/bots`, `/leaderboard`, and `/workshop`. Assert the accessible mobile menu button toggles a navigation region.

- [ ] **Step 2: Implement the shared shell**

`app/layout.tsx` must set the title to `CryptoBot Labs｜WEEX 自動交易策略實驗室`, set a product-specific description, wrap all routes with `SiteHeader`, `main`, and `SiteFooter`, and remove all starter preview metadata.

- [ ] **Step 3: Implement global tokens and motion**

Define exact tokens in `:root`: `--bg:#06070b`, `--panel:#0e111a`, `--violet:#8b63ff`, `--cyan:#4cddff`, `--mint:#58f0b0`, `--danger:#ff6b62`, `--text:#f7f8fc`, `--muted:#929bad`. Include focus rings, glass panels, responsive containers, skeleton/loading states, chart styles, keyframes for orbit, float, scan, and pulse, and a `prefers-reduced-motion` block that sets animation duration to `0.01ms` and disables parallax transforms.

- [ ] **Step 4: Implement accessible charts and metrics**

`PerformanceChart` accepts `{ points, label, tone }`, renders an HTML/CSS chart with a text summary and accessible label, and must not rely on color alone. `MetricCard` accepts `{ label, value, hint, tone }` and provides a semantic description.

- [ ] **Step 5: Run navigation tests and build**

Run: `pnpm test -- tests/navigation.test.tsx`

Expected: PASS.

Run: `pnpm run build`

Expected: successful worker-compatible production build.

- [ ] **Step 6: Commit the design system**

```bash
git add app/layout.tsx app/globals.css components tests/navigation.test.tsx
git commit -m "feat: build Orbital Lab design system"
```

---

### Task 5: Build the Landing Page, Bot Catalog, and Bot Detail Routes

**Files:**
- Replace: `app/page.tsx`
- Create: `components/OrbitalHero.tsx`
- Create: `components/BotCard.tsx`
- Create: `app/bots/page.tsx`
- Create: `app/bots/[id]/page.tsx`

**Interfaces:**
- Consumes: `BOT_CATALOG`, `BotDefinition`, `PerformanceChart`, `MetricCard`, and `exportBotPackage`.
- Produces: landing conversion flow, filterable bot catalog, and detail views.

- [ ] **Step 1: Build the cinematic landing page**

Use an Orbital Hero with the copy `把交易想法，組裝成你的機器人。`, a WEEX-only badge, animated strategy core, floating simulated metrics, and primary links to `/bots` and `/workshop`. Add sections for the three-step flow, multi-strategy workshop, JavaScript mode, featured bots, leaderboard preview, WEEX boundary, and final call to action. Every performance preview includes the simulation disclaimer.

- [ ] **Step 2: Build the filterable catalog**

Make `/bots` a client component with market, risk, tag, and sort controls. Filtering and sorting must be derived state, not duplicated state. Each card displays market, risk, tags, return, drawdown, win rate, a mini chart, and buttons for details and quick download.

- [ ] **Step 3: Build detail routes for all bot ids**

Resolve the route id against `BOT_CATALOG`, show a not-found state for unknown ids, and render the full metrics grid, equity curve, monthly performance, explanation, suitable market, risk note, `複製到組裝車間`, and `下載官方策略包` actions.

- [ ] **Step 4: Verify route content**

Run: `pnpm run build`

Expected: `/`, `/bots`, and ten bot detail routes compile without type errors.

- [ ] **Step 5: Commit discovery routes**

```bash
git add app/page.tsx app/bots components/OrbitalHero.tsx components/BotCard.tsx
git commit -m "feat: add bot discovery and detail experience"
```

---

### Task 6: Build the Dynamic Leaderboard

**Files:**
- Create: `components/LeaderboardTable.tsx`
- Create: `app/leaderboard/page.tsx`

**Interfaces:**
- Consumes: `BOT_CATALOG`, `BotMetrics`, and `PerformanceChart`.
- Produces: period and metric sorting controls with animated ranking changes.

- [ ] **Step 1: Implement period projections**

Derive 30-day, 90-day, and one-year values from the fixed one-year data with deterministic scale factors `0.14`, `0.37`, and `1`. Never mutate `BOT_CATALOG`.

- [ ] **Step 2: Implement rankings and comparisons**

Support sorting by total return, stability, absolute drawdown, and Sharpe. Render podium cards for the top three, an accessible complete table for all ten, comparative bars, and a risk-versus-return panel. Use stable bot ids as keys so CSS transitions preserve continuity.

- [ ] **Step 3: Verify build and keyboard controls**

Run: `pnpm run build`

Expected: successful build; all sort and period controls are native buttons or selects with visible focus states.

- [ ] **Step 4: Commit leaderboard**

```bash
git add app/leaderboard/page.tsx components/LeaderboardTable.tsx
git commit -m "feat: add animated bot leaderboard"
```

---

### Task 7: Build the Multi-Strategy Workshop and Backtest Flow

**Files:**
- Create: `app/workshop/page.tsx`
- Create: `components/workshop/StrategyPalette.tsx`
- Create: `components/workshop/ParameterPanel.tsx`
- Create: `components/workshop/StrategySummary.tsx`
- Create: `components/workshop/BacktestPanel.tsx`
- Create: `tests/workshop-flow.test.tsx`

**Interfaces:**
- Consumes: strategy catalog, presets, `validateConfig`, `summarizeStrategy`, `runBacktest`, and storage adapter.
- Produces: editable `BotConfig` and a successful `BacktestReport`.

- [ ] **Step 1: Write a failing beginner flow test**

Render the workshop, select `穩健趨勢`, add `RSI Rebound`, change the RSI threshold to `28`, switch logic to `符合全部條件`, run the backtest, and assert that a result labelled `模擬回測資料，不代表未來績效` appears. Add a second test that removes every exit/risk rule and expects the run button to be disabled with a clear missing-rule message.

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm test -- tests/workshop-flow.test.tsx`

Expected: FAIL because the workshop route and components do not exist.

- [ ] **Step 3: Implement the strategy palette**

Group blocks under entry, confirm, exit, position, and risk headings. Support search, multiple selection, preset loading, click-to-add, removal, and keyboard move-up/move-down controls. Show compatible blocks with violet/cyan treatment and conflicting blocks with warning text.

- [ ] **Step 4: Implement parameter editing and summaries**

Render sliders plus numeric inputs from each parameter's min, max, and step. Include market, symbol, timeframe, logic mode, and leverage controls. Every change immediately updates `summarizeStrategy(config)` and saves the draft through `saveDraft`.

- [ ] **Step 5: Implement the backtest state machine**

Use exact states `idle | validating | running | complete | error`. Validation errors return to `idle` with messages. Running shows a short signal-flow animation and then calls `runBacktest`; complete renders the accessible chart and nine metrics. Re-running with unchanged settings returns identical data.

- [ ] **Step 6: Run workshop tests**

Run: `pnpm test -- tests/workshop-flow.test.tsx`

Expected: all beginner-flow and validation tests PASS.

- [ ] **Step 7: Commit quick assembly**

```bash
git add app/workshop components/workshop tests/workshop-flow.test.tsx
git commit -m "feat: add multi-strategy bot workshop"
```

---

### Task 8: Add JavaScript Mode, Export, Import, and Download UX

**Files:**
- Create: `components/workshop/JavaScriptEditor.tsx`
- Create: `components/workshop/PackagePanel.tsx`
- Modify: `app/workshop/page.tsx`
- Modify: `components/BotCard.tsx`
- Modify: `app/bots/[id]/page.tsx`
- Modify: `tests/workshop-flow.test.tsx`

**Interfaces:**
- Consumes: `validateJavaScript`, `exportBotPackage`, `importBotPackage`, `runBacktest`.
- Produces: safe source validation, five-file ZIP download, and package import restoration.

- [ ] **Step 1: Add failing source-safety and package UI tests**

Assert that entering `fetch('https://api.binance.com')` shows `偵測到非 WEEX 交易所識別字` and disables export. Assert that a valid WEEX example enables backtesting. Mock `exportBotPackage` and verify the download action uses a `.zip` filename. Mock `importBotPackage` and verify imported values populate the form.

- [ ] **Step 2: Implement JavaScript mode without execution**

Use a labelled `textarea` with line count, a WEEX example template, static validation messages, and a parsed plain-language preview. Do not instantiate or execute the source in any environment.

- [ ] **Step 3: Implement download and import panels**

Offer `快速下載` for catalog/detail defaults and `下載完整策略包` after a successful workshop backtest. Before creating the URL, show a confirmation stating the package is simulated and cannot independently trade. Revoke object URLs after clicking. Accept only `.zip` imports, show named structural errors, and preserve the current draft if import fails.

- [ ] **Step 4: Run focused and full tests**

Run: `pnpm test -- tests/workshop-flow.test.tsx tests/bot-package.test.ts`

Expected: PASS.

Run: `pnpm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit complete workshop delivery**

```bash
git add app components/workshop components/BotCard.tsx tests
git commit -m "feat: add safe JavaScript and package workflows"
```

---

### Task 9: Final Accessibility, Responsive, Metadata, and Production Validation

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Create: `public/og.png`
- Create or modify: `.gitignore`

**Interfaces:**
- Consumes all completed routes and components.
- Produces the validated deployment artifact and social metadata.

- [ ] **Step 1: Complete responsive and accessibility checks**

Confirm all interactive controls have labels, visible focus, minimum touch size, and non-color status cues. Add chart text summaries, mobile single-column cards, sticky mobile workshop actions, and reduced-motion behavior. Add `.superpowers/` to `.gitignore` so brainstorming artifacts are never shipped.

- [ ] **Step 2: Generate and inspect one bespoke social card**

After the final headline and palette are stable, generate exactly one landscape social preview that contains `CryptoBot Labs`, the headline `把交易想法，組裝成你的機器人。`, the Orbital Lab purple/cyan strategy core, and a clear `WEEX ONLY` badge. Inspect text accuracy; retry once only if unusable. Save a valid result to `public/og.png` and add request-host-derived Open Graph and X metadata. Omit `og:image` if no valid card is available.

- [ ] **Step 3: Run the complete verification suite**

Run:

```bash
pnpm test
pnpm run build
```

Expected: every test PASS and the production build succeeds without API keys, trading requests, starter preview imports, or non-WEEX exchange endpoints.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
rg -n "apiKey|API_KEY|secret|eval\(|new Function|binance|okx|bybit|coinbase" app components data lib
```

Expected: no whitespace errors; no secrets or executable source paths; non-WEEX names appear only in the intentional validation denylist and user-facing safety tests.

- [ ] **Step 5: Commit the validated site**

```bash
git add app components data lib tests public package.json pnpm-lock.yaml .openai/hosting.json .gitignore
git commit -m "feat: complete CryptoBot Labs prototype"
```

---

### Task 10: Publish the Validated Site

**Files:**
- Modify: `.openai/hosting.json` with the created Sites `project_id`.

**Interfaces:**
- Consumes: successful `pnpm run build` output.
- Produces: private deployed Sites URL.

- [ ] **Step 1: Create or reuse the Sites project**

If `.openai/hosting.json` has no `project_id`, create the site once and persist only the returned `project_id`. Reuse an existing project and source credential when present.

- [ ] **Step 2: Save and deploy the exact validated version**

Package with the Sites `package-site.sh` helper, save one version using the branch-head commit SHA, and deploy privately. Do not publish publicly without explicit approval.

- [ ] **Step 3: Poll deployment status**

Poll the deployment directly until `status: "succeeded"` or a terminal failure. On success, open the exact deployed URL in Codex and return it as the primary deliverable.

- [ ] **Step 4: Stop local preview services**

After the hosted site is confirmed, stop the retained development server and brainstorming companion. Preserve source and strategy-package behavior exactly as validated.
