import JSZip from "jszip";
import { runBacktest } from "./backtest";
import { hasBotConfigShape, validateConfig, validateJavaScript } from "./strategy-validation";
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

type UnknownRecord = Record<string, unknown>;

const METRIC_FIELDS = [
  "totalReturn",
  "annualizedReturn",
  "maxDrawdown",
  "winRate",
  "profitFactor",
  "sharpe",
  "trades",
  "runningDays",
  "stability",
] as const;

const isRecord = (value: unknown): value is UnknownRecord => (
  value !== null && typeof value === "object" && !Array.isArray(value)
);

const isString = (value: unknown): value is string => typeof value === "string";
const isNonEmptyString = (value: unknown): value is string => isString(value) && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isManifest = (value: unknown): value is PackageManifest => (
  isRecord(value)
  && Number.isInteger(value.formatVersion)
  && isNonEmptyString(value.exchange)
  && (value.createdAt === undefined || isString(value.createdAt))
);

const hasFiniteMetrics = (value: unknown): boolean => (
  isRecord(value) && METRIC_FIELDS.every((field) => isFiniteNumber(value[field]))
);

const isBacktestReport = (value: unknown): value is BacktestReport => (
  isRecord(value)
  && isString(value.seed)
  && isString(value.generatedAt)
  && value.disclaimer === "模擬回測資料，不代表未來績效"
  && hasFiniteMetrics(value.metrics)
  && Array.isArray(value.equityCurve)
  && value.equityCurve.every((point) => (
    isRecord(point) && isString(point.label) && isFiniteNumber(point.value)
  ))
);

const invalidConfigError = (errors: string[]): Error => new Error(`策略設定無效：${errors.join("；")}`);

const assertConfig = (value: unknown, validateSource: boolean): BotConfig => {
  if (!hasBotConfigShape(value)) throw new Error("策略設定無效：資料結構不正確");
  const config = value;
  const validation = validateConfig(validateSource ? config : { ...config, source: undefined });
  if (!validation.valid) throw invalidConfigError(validation.errors);
  return config as BotConfig;
};

const assertReport = (value: unknown): BacktestReport => {
  if (!isBacktestReport(value)) throw new Error("回測報告格式無效：backtest-report.json");
  return value;
};

const reportsMatch = (report: BacktestReport, expected: BacktestReport): boolean => (
  report.seed === expected.seed
  && report.generatedAt === expected.generatedAt
  && report.disclaimer === expected.disclaimer
  && METRIC_FIELDS.every((field) => report.metrics[field] === expected.metrics[field])
  && report.equityCurve.length === expected.equityCurve.length
  && report.equityCurve.every((point, index) => (
    point.label === expected.equityCurve[index]?.label
    && point.value === expected.equityCurve[index]?.value
  ))
);

const assertSource = (source: string): void => {
  const validation = validateJavaScript(source);
  if (!validation.valid) throw new Error(`策略程式碼無效：${validation.errors.join("；")}`);
};

const parseJsonFile = async (zip: JSZip, name: string): Promise<unknown> => {
  try {
    const contents = await zip.file(name)!.async("string");
    return JSON.parse(contents) as unknown;
  } catch {
    throw new Error(`策略套件 JSON 格式無效：${name}`);
  }
};

const readStrategySource = async (zip: JSZip): Promise<string> => {
  try {
    return await zip.file("strategy.js")!.async("string");
  } catch {
    throw new Error("無法讀取策略程式碼：strategy.js");
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
  const validConfig = assertConfig(config, true);
  const validReport = assertReport(report);
  const source = validConfig.source ?? defaultStrategySource(validConfig);
  assertSource(source);

  const zip = new JSZip();
  zip.file("bot-config.json", JSON.stringify(validConfig, null, 2));
  zip.file("strategy.js", source);
  zip.file("backtest-report.json", JSON.stringify(validReport, null, 2));
  zip.file("README-zh-TW.md", packageReadme(validConfig));
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

  const unexpectedEntry = Object.keys(zip.files).find((name) => (
    !REQUIRED_FILES.some((required) => required === name) || zip.files[name].dir
  ));
  if (unexpectedEntry !== undefined) {
    throw new Error(`策略套件包含未預期的項目：${unexpectedEntry}`);
  }

  const manifestValue = await parseJsonFile(zip, "manifest.json");
  if (!isManifest(manifestValue)) throw new Error("策略套件資訊無效：manifest.json");
  const manifest = manifestValue;
  if (manifest.formatVersion !== FORMAT_VERSION) {
    throw new Error(`不支援的策略套件版本：${String(manifest.formatVersion)}`);
  }
  if (manifest.exchange !== "WEEX") throw new Error("只支援 WEEX 交易所");

  const configValue = await parseJsonFile(zip, "bot-config.json");
  const config = assertConfig(configValue, false);

  const strategySource = await readStrategySource(zip);
  assertSource(strategySource);
  if (config.source !== undefined && config.source !== strategySource) {
    throw new Error("策略程式碼與設定不一致");
  }

  const reportValue = await parseJsonFile(zip, "backtest-report.json");
  const report = assertReport(reportValue);
  const expectedReport = runBacktest(config);
  if (!reportsMatch(report, expectedReport)) {
    throw new Error("回測報告與策略設定不一致：backtest-report.json");
  }

  return { config, report };
};
