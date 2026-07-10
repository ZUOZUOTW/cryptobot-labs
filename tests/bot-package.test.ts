import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_CATALOG } from "../data/bots";
import { STRATEGY_PRESETS } from "../data/strategies";
import { runBacktest } from "../lib/backtest";
import { buildBotPackageFiles, exportBotPackage, importBotPackage } from "../lib/bot-package";
import { loadDraft, saveDraft } from "../lib/storage";
import type { BacktestReport, BotConfig } from "../lib/types";

const validConfig = STRATEGY_PRESETS.find((preset) => preset.name === "突破追蹤")!;
const strategySource = "const exchange = 'WEEX';";
const configWithSource: BotConfig = { ...validConfig, source: strategySource };
const requiredFiles = [
  "README-zh-TW.md",
  "backtest-report.json",
  "bot-config.json",
  "manifest.json",
  "strategy.js",
];

const packageFile = async (files: Record<string, string>): Promise<File> => {
  const zip = new JSZip();
  for (const [name, contents] of Object.entries(files)) zip.file(name, contents);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new File([bytes], "bot.zip", { type: "application/zip" });
};

const validPackageFiles = (): Record<string, string> => ({
  "README-zh-TW.md": "這是模擬原型，無法獨立執行實盤交易。",
  "backtest-report.json": JSON.stringify(runBacktest(configWithSource)),
  "bot-config.json": JSON.stringify(configWithSource),
  "manifest.json": JSON.stringify({ formatVersion: 1, exchange: "WEEX" }),
  "strategy.js": strategySource,
});

describe("bot package", () => {
  it("exports all five required files and re-imports the same WEEX config", async () => {
    const report = runBacktest(configWithSource);
    const blob = await exportBotPackage(configWithSource, report);
    const zip = await JSZip.loadAsync(blob);

    expect(Object.keys(zip.files).sort()).toEqual(requiredFiles);
    await expect(zip.file("manifest.json")!.async("string")).resolves.toContain('"exchange": "WEEX"');
    await expect(zip.file("README-zh-TW.md")!.async("string")).resolves.toContain("無法獨立執行實盤交易");

    const imported = await importBotPackage(new File([blob], "bot.zip"));
    expect(imported).toEqual({ config: configWithSource, report });
  });

  it("builds the same five validated files for individual-download fallback", async () => {
    const files = await buildBotPackageFiles(configWithSource, runBacktest(configWithSource));

    expect(files.map((file) => file.name).sort()).toEqual(requiredFiles);
    expect(files.every((file) => file.blob instanceof Blob)).toBe(true);
  });

  it("preserves an absent config source while validating the generated strategy source", async () => {
    const report = runBacktest(validConfig);
    const blob = await exportBotPackage(validConfig, report);
    const zip = await JSZip.loadAsync(blob);
    const packagedConfig = JSON.parse(await zip.file("bot-config.json")!.async("string")) as BotConfig;
    const packagedSource = await zip.file("strategy.js")!.async("string");

    expect(packagedConfig).toEqual(validConfig);
    expect(packagedConfig).not.toHaveProperty("source");
    expect(packagedSource).toContain("WEEX");
    await expect(importBotPackage(new File([blob], "bot.zip"))).resolves.toEqual({
      config: validConfig,
      report,
    });
  });

  it("rejects an invalid config before exporting", async () => {
    const invalidConfig = { ...validConfig, exchange: "BINANCE" as "WEEX" };

    await expect(exportBotPackage(invalidConfig, runBacktest(validConfig)))
      .rejects.toThrow("策略設定無效：只支援 WEEX 交易所");
  });

  it("rejects a package whose manifest does not declare WEEX", async () => {
    const files = validPackageFiles();
    files["manifest.json"] = JSON.stringify({ formatVersion: 1, exchange: "BINANCE" });

    await expect(importBotPackage(await packageFile(files))).rejects.toThrow("只支援 WEEX 交易所");
  });

  it("rejects malformed ZIP input with a stable package error", async () => {
    await expect(importBotPackage(new File(["not a zip"], "bot.zip")))
      .rejects.toThrow("策略套件 ZIP 格式無效");
  });

  it("rejects a package missing a required file", async () => {
    const files = validPackageFiles();
    delete files["strategy.js"];

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略套件缺少必要檔案：strategy.js");
  });

  it.each([
    ["extra.txt", "unexpected"],
    ["nested/", ""],
  ])("rejects unexpected top-level ZIP entry %s", async (name, contents) => {
    const files = validPackageFiles();
    files[name] = contents;

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow(`策略套件包含未預期的項目：${name}`);
  });

  it("rejects unsupported package versions", async () => {
    const files = validPackageFiles();
    files["manifest.json"] = JSON.stringify({ formatVersion: 2, exchange: "WEEX" });

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("不支援的策略套件版本：2");
  });

  it("rejects invalid JSON with the affected file name", async () => {
    const files = validPackageFiles();
    files["bot-config.json"] = "{not-json";

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略套件 JSON 格式無效：bot-config.json");
  });

  it.each(["null", "[]", "{}"])("rejects malformed manifest shape %s", async (manifest) => {
    const files = validPackageFiles();
    files["manifest.json"] = manifest;

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略套件資訊無效：manifest.json");
  });

  it("rejects incomplete config shapes", async () => {
    const files = validPackageFiles();
    const incompleteConfig: Partial<BotConfig> = { ...configWithSource };
    delete incompleteConfig.id;
    files["bot-config.json"] = JSON.stringify(incompleteConfig);

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略設定無效：資料結構不正確");
  });

  it.each(["null", "[]"])("rejects null or array config shape %s", async (config) => {
    const files = validPackageFiles();
    files["bot-config.json"] = config;

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略設定無效：資料結構不正確");
  });

  it("rejects a non-WEEX config under a WEEX manifest", async () => {
    const files = validPackageFiles();
    files["bot-config.json"] = JSON.stringify({ ...configWithSource, exchange: "BINANCE" });

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略設定無效：只支援 WEEX 交易所");
  });

  it("validates config before parsing a malformed report", async () => {
    const files = validPackageFiles();
    files["bot-config.json"] = JSON.stringify({ ...configWithSource, blocks: [] });
    files["backtest-report.json"] = "{not-json";

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略設定無效：至少需要一個進場訊號；至少需要一個出場或風控規則");
  });

  it("rejects non-WEEX strategy source even when bot-config source is safe", async () => {
    const files = validPackageFiles();
    files["strategy.js"] = "fetch('https://api.bybit.com')";

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("偵測到非 WEEX 網域：api.bybit.com");
  });

  it("rejects mismatched config and strategy sources", async () => {
    const files = validPackageFiles();
    files["strategy.js"] = "const exchange = 'WEEX'; // different";

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略程式碼與設定不一致");
  });

  it("rejects import when recognized source controls disagree with bot-config", async () => {
    const files = validPackageFiles();
    const source = "export const strategy={exchange:'WEEX',symbol:'ETHUSDT'};";
    const config = { ...configWithSource, source };
    files["bot-config.json"] = JSON.stringify(config);
    files["strategy.js"] = source;
    files["backtest-report.json"] = JSON.stringify(runBacktest(configWithSource));

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("JavaScript 的交易對（ETHUSDT）與策略設定（BTCUSDT）不一致");
  });

  it("rejects export when recognized source controls disagree with bot-config", async () => {
    const config = {
      ...configWithSource,
      source: "export const strategy={exchange:'WEEX',timeframe:'4h'};",
    };
    await expect(exportBotPackage(config, runBacktest(configWithSource)))
      .rejects.toThrow("JavaScript 的時間週期（4h）與策略設定（1h）不一致");
  });

  it("rejects incomplete backtest report shapes", async () => {
    const files = validPackageFiles();
    files["backtest-report.json"] = JSON.stringify({ seed: "incomplete" });

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("回測報告格式無效：backtest-report.json");
  });

  it("rejects a structurally valid report generated for a different config", async () => {
    const files = validPackageFiles();
    const otherConfig = { ...configWithSource, symbol: "ETHUSDT" };
    files["bot-config.json"] = JSON.stringify(otherConfig);
    files["backtest-report.json"] = JSON.stringify(runBacktest(configWithSource));

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("回測報告與策略設定不一致：backtest-report.json");
  });

  it("accepts a deterministic report whose JSON keys use a different order", async () => {
    const files = validPackageFiles();
    const report = runBacktest(configWithSource);
    files["backtest-report.json"] = JSON.stringify({
      disclaimer: report.disclaimer,
      equityCurve: report.equityCurve,
      metrics: Object.fromEntries(Object.entries(report.metrics).reverse()),
      generatedAt: report.generatedAt,
      seed: report.seed,
    });

    await expect(importBotPackage(await packageFile(files))).resolves.toEqual({
      config: configWithSource,
      report,
    });
  });

  it.each([
    ["seed", (report: BacktestReport) => ({ ...report, seed: "tampered-seed" })],
    ["generatedAt", (report: BacktestReport) => ({ ...report, generatedAt: "2026-01-01T00:00:00.000Z" })],
    ["metrics", (report: BacktestReport) => ({ ...report, metrics: { ...report.metrics, totalReturn: report.metrics.totalReturn + 1 } })],
    ["equity curve", (report: BacktestReport) => ({ ...report, equityCurve: report.equityCurve.map((point, index) => index === 0 ? { ...point, value: point.value + 1 } : point) })],
  ])("rejects a report with mismatched %s provenance", async (_field, mutate) => {
    const files = validPackageFiles();
    files["backtest-report.json"] = JSON.stringify(mutate(runBacktest(configWithSource)));

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("回測報告與策略設定不一致：backtest-report.json");
  });

  it.each(["null", "[]"])("rejects null or array report shape %s", async (report) => {
    const files = validPackageFiles();
    files["backtest-report.json"] = report;

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("回測報告格式無效：backtest-report.json");
  });

  it("rejects invalid backtest reports before exporting", async () => {
    const report = runBacktest(configWithSource);
    const invalidReport = {
      ...report,
      metrics: { ...report.metrics, sharpe: Number.NaN },
    } as BacktestReport;

    await expect(exportBotPackage(configWithSource, invalidReport))
      .rejects.toThrow("回測報告格式無效：backtest-report.json");
  });

  it("rejects a structurally valid but mismatched report before exporting", async () => {
    const mismatched = runBacktest({ ...configWithSource, symbol: "ETHUSDT" });

    await expect(exportBotPackage(configWithSource, mismatched))
      .rejects.toThrow("回測報告與策略設定不一致：backtest-report.json");
  });

  it.each([
    ["tampered bound", (config: BotConfig) => ({
      ...config,
      blocks: config.blocks.map((block, index) => index === 0 ? {
        ...block,
        parameters: block.parameters.map((parameter, parameterIndex) => parameterIndex === 0
          ? { ...parameter, max: parameter.max + 100, value: parameter.max + 50 }
          : parameter),
      } : block),
    })],
    ["duplicate block", (config: BotConfig) => ({ ...config, blocks: [...config.blocks, config.blocks[0]] })],
    ["unknown block", (config: BotConfig) => ({
      ...config,
      blocks: [{ ...config.blocks[0], id: "unknown-block" }, ...config.blocks.slice(1)],
    })],
  ])("rejects imported canonical strategy tampering: %s", async (_case, mutate) => {
    const files = validPackageFiles();
    const config = mutate(configWithSource);
    files["bot-config.json"] = JSON.stringify(config);
    files["backtest-report.json"] = JSON.stringify(runBacktest(configWithSource));

    await expect(importBotPackage(await packageFile(files))).rejects.toThrow(/策略設定無效/);
  });

  it.each([
    ["block name", (config: BotConfig) => ({ ...config, blocks: config.blocks.map((block, index) => index === 0 ? { ...block, name: "偽造名稱" } : block) })],
    ["block description", (config: BotConfig) => ({ ...config, blocks: config.blocks.map((block, index) => index === 0 ? { ...block, description: "偽造說明" } : block) })],
    ["parameter label", (config: BotConfig) => ({ ...config, blocks: config.blocks.map((block, index) => index === 0 ? { ...block, parameters: block.parameters.map((item, itemIndex) => itemIndex === 0 ? { ...item, label: "偽造標籤" } : item) } : block) })],
    ["parameter suffix", (config: BotConfig) => ({ ...config, blocks: config.blocks.map((block, index) => index === 0 ? { ...block, parameters: block.parameters.map((item, itemIndex) => itemIndex === 0 ? { ...item, suffix: "BTC" } : item) } : block) })],
  ])("rejects imported tampered canonical metadata: %s", async (_case, mutate) => {
    const files = validPackageFiles();
    files["bot-config.json"] = JSON.stringify(mutate(configWithSource));
    await expect(importBotPackage(await packageFile(files))).rejects.toThrow(/策略設定無效/);
  });

  it("round-trips every built-in bot with canonical strategy blocks", async () => {
    for (const bot of BOT_CATALOG) {
      const config: BotConfig = {
        id: bot.id, name: bot.name, exchange: bot.exchange, market: bot.market,
        symbol: bot.symbol, timeframe: bot.timeframe, logicMode: bot.logicMode,
        leverage: bot.leverage, blocks: bot.blocks,
      };
      const report = runBacktest(config);
      const blob = await exportBotPackage(config, report);
      await expect(importBotPackage(new File([blob], `${bot.id}.zip`))).resolves.toEqual({ config, report });
    }
  });

  it("rejects configs that fail domain validation", async () => {
    const files = validPackageFiles();
    files["bot-config.json"] = JSON.stringify({ ...validConfig, blocks: [] });

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略設定無效：至少需要一個進場訊號；至少需要一個出場或風控規則");
  });
});

describe("draft storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("saves and loads a draft from the fixed storage key", () => {
    expect(saveDraft(validConfig)).toEqual({ ok: true });
    expect(localStorage.getItem("cryptobot-labs:draft:v1")).toBe(JSON.stringify(validConfig));
    expect(loadDraft()).toEqual(validConfig);
  });

  it("returns null for missing or malformed storage", () => {
    expect(loadDraft()).toBeNull();
    localStorage.setItem("cryptobot-labs:draft:v1", "{not-json");
    expect(loadDraft()).toBeNull();
  });

  it.each([
    { ...validConfig, id: "" },
    { ...validConfig, blocks: [{ ...validConfig.blocks[0], parameters: null }] },
  ])("rejects a structurally malformed draft on save", (malformedConfig) => {
    expect(saveDraft(malformedConfig as unknown as BotConfig)).toEqual({
      ok: false,
      reason: "策略設定無效：策略設定格式不正確",
    });
    expect(localStorage.getItem("cryptobot-labs:draft:v1")).toBeNull();
  });

  it.each([
    { ...validConfig, symbol: "" },
    { ...validConfig, blocks: "not-an-array" },
  ])("returns null for a structurally malformed stored draft", (malformedConfig) => {
    localStorage.setItem("cryptobot-labs:draft:v1", JSON.stringify(malformedConfig));

    expect(loadDraft()).toBeNull();
  });

  it("returns a failure result instead of throwing when storage fails", () => {
    const error = new Error("quota exceeded");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw error; });

    expect(saveDraft(validConfig)).toEqual({ ok: false, reason: "無法儲存策略草稿" });
  });

  it("returns null instead of throwing when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });

    expect(loadDraft()).toBeNull();
  });

  it("persists and restores structurally safe incomplete and invalid-JavaScript drafts", () => {
    const incomplete = { ...validConfig, blocks: [], source: "const = ;" };

    expect(saveDraft(incomplete)).toEqual({ ok: true });
    expect(loadDraft()).toEqual(incomplete);
  });
});
