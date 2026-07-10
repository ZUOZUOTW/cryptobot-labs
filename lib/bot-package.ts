import JSZip from "jszip";
import { validateConfig } from "./strategy-validation";
import type { BacktestReport, BotConfig } from "./types";

const FORMAT_VERSION = 1;
const REQUIRED_FILES = [
  "bot-config.json",
  "strategy.js",
  "backtest-report.json",
  "README-zh-TW.md",
  "manifest.json",
] as const;

interface PackageManifest {
  formatVersion: number;
  exchange: string;
  createdAt?: string;
}

const invalidConfigError = (errors: string[]): Error => new Error(`策略設定無效：${errors.join("；")}`);

const validatePackageConfig = (config: BotConfig): void => {
  try {
    const validation = validateConfig(config);
    if (!validation.valid) throw invalidConfigError(validation.errors);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("策略設定無效：")) throw error;
    throw new Error("策略設定無效：資料結構不正確");
  }
};

const parseJsonFile = async <T>(zip: JSZip, name: string): Promise<T> => {
  try {
    const contents = await zip.file(name)!.async("string");
    return JSON.parse(contents) as T;
  } catch {
    throw new Error(`策略套件 JSON 格式無效：${name}`);
  }
};

const defaultStrategySource = (config: BotConfig): string => [
  "/**",
  " * CryptoBot Labs WEEX 策略模擬原型。",
  " * 此檔案無法獨立執行實盤交易。",
  " */",
  `export const strategyId = ${JSON.stringify(config.id)};`,
  "export const exchange = \"WEEX\";",
  "",
].join("\n");

const packageReadme = (config: BotConfig): string => [
  `# ${config.name}`,
  "",
  "此策略套件是 CryptoBot Labs 產生的模擬原型，僅供策略編輯與回測用途。",
  "本套件無法獨立執行實盤交易，也不會連線至交易所送出訂單。",
  "所有回測資料均為模擬結果，不代表未來績效。",
  "",
].join("\n");

export const exportBotPackage = async (config: BotConfig, report: BacktestReport): Promise<Blob> => {
  validatePackageConfig(config);

  const zip = new JSZip();
  zip.file("bot-config.json", JSON.stringify(config, null, 2));
  zip.file("strategy.js", config.source ?? defaultStrategySource(config));
  zip.file("backtest-report.json", JSON.stringify(report, null, 2));
  zip.file("README-zh-TW.md", packageReadme(config));
  zip.file("manifest.json", JSON.stringify({
    formatVersion: FORMAT_VERSION,
    exchange: "WEEX",
    createdAt: new Date().toISOString(),
  }, null, 2));

  return zip.generateAsync({ type: "blob" });
};

export const importBotPackage = async (file: Blob): Promise<{ config: BotConfig; report: BacktestReport }> => {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("策略套件 ZIP 格式無效");
  }

  for (const name of REQUIRED_FILES) {
    if (zip.file(name) === null) throw new Error(`策略套件缺少必要檔案：${name}`);
  }

  const manifest = await parseJsonFile<PackageManifest>(zip, "manifest.json");
  if (manifest.formatVersion !== FORMAT_VERSION) {
    throw new Error(`不支援的策略套件版本：${String(manifest.formatVersion)}`);
  }
  if (manifest.exchange !== "WEEX") throw new Error("只支援 WEEX 交易所");

  const config = await parseJsonFile<BotConfig>(zip, "bot-config.json");
  const report = await parseJsonFile<BacktestReport>(zip, "backtest-report.json");
  validatePackageConfig(config);

  return { config, report };
};
