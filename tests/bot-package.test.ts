import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRATEGY_PRESETS } from "../data/strategies";
import { runBacktest } from "../lib/backtest";
import { exportBotPackage, importBotPackage } from "../lib/bot-package";
import { loadDraft, saveDraft } from "../lib/storage";

const validConfig = STRATEGY_PRESETS.find((preset) => preset.name === "突破追蹤")!;
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
  "backtest-report.json": JSON.stringify(runBacktest(validConfig)),
  "bot-config.json": JSON.stringify(validConfig),
  "manifest.json": JSON.stringify({ formatVersion: 1, exchange: "WEEX" }),
  "strategy.js": validConfig.source ?? "// WEEX strategy",
});

describe("bot package", () => {
  it("exports all five required files and re-imports the same WEEX config", async () => {
    const report = runBacktest(validConfig);
    const blob = await exportBotPackage(validConfig, report);
    const zip = await JSZip.loadAsync(blob);

    expect(Object.keys(zip.files).sort()).toEqual(requiredFiles);
    await expect(zip.file("manifest.json")!.async("string")).resolves.toContain('"exchange": "WEEX"');
    await expect(zip.file("README-zh-TW.md")!.async("string")).resolves.toContain("無法獨立執行實盤交易");

    const imported = await importBotPackage(new File([blob], "bot.zip"));
    expect(imported).toEqual({ config: validConfig, report });
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

  it("rejects a package missing a required file", async () => {
    const files = validPackageFiles();
    delete files["strategy.js"];

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略套件缺少必要檔案：strategy.js");
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

  it("rejects configs that fail domain validation", async () => {
    const files = validPackageFiles();
    files["bot-config.json"] = JSON.stringify({ ...validConfig, blocks: [] });

    await expect(importBotPackage(await packageFile(files)))
      .rejects.toThrow("策略設定無效：至少需要一個進場訊號；至少需要一個出場或風控規則");
  });
});

describe("draft storage", () => {
  beforeEach(() => localStorage.clear());

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

  it("returns a failure result instead of throwing when storage fails", () => {
    const error = new Error("quota exceeded");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw error; });

    expect(saveDraft(validConfig)).toEqual({ ok: false, reason: "quota exceeded" });
    setItem.mockRestore();
  });

  it("returns null instead of throwing when storage cannot be read", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });

    expect(loadDraft()).toBeNull();
    getItem.mockRestore();
  });
});
