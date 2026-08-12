"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { backtestConfigFingerprint } from "../../lib/backtest";
import { validateConfig } from "../../lib/strategy-validation";
import type { BotConfig } from "../../lib/types";
import { BacktestResultCard } from "./BacktestResultCard";
import { CreateRunPanel } from "../runs/CreateRunPanel";
import type { HistoricalBacktestRecord, HistoricalRequest } from "./BacktestResultCard";
import { formalBacktestToReport, type FormalBacktestEvidence } from "../../lib/formal-backtest-report";

const INTERVAL_MS: Readonly<Record<string, number>> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_historical_range: "回測區間不符合歷史行情限制，請縮短區間。",
  historical_dataset_incomplete: "公開行情無法完整覆蓋此區間，請調整區間或資料缺口政策。",
  historical_funding_incomplete: "此區間的歷史資金費率資料不完整。",
  strategy_request_mismatch: "策略版本與目前市場設定不一致，請重新送出。",
  invalid_strategy_configuration: "JavaScript 策略格式或輸出不符合安全規範。",
  data_fetch_failed: "目前無法取得公開行情，請稍後重試。",
  backtest_execution_failed: "歷史回測未能完成，請檢查設定後重試。",
  strategy_integrity_failed: "回測證據與目前策略版本不一致，請重新保存策略後再試。",
  invalid_economic_parameters: "初始資金、成本或槓桿設定超出歷史回測可計算範圍。",
  strategy_service_unavailable: "歷史回測儲存服務目前無法連線，請稍後再試。",
};

const alignedRecentRange = (config: BotConfig): { startTime: number; endTime: number } => {
  const interval = INTERVAL_MS[config.timeframe] ?? 3_600_000;
  const now = Date.now();
  const endTime = Math.floor(now / interval) * interval;
  const maximumCandles = config.market === "spot" ? 900 : Math.min(2_000, Math.floor(90 * 86_400_000 / interval));
  const preferredCandles = Math.max(2, Math.min(maximumCandles, Math.floor(30 * 86_400_000 / interval)));
  return { startTime: endTime - preferredCandles * interval, endTime };
};

const toLocalInput = (value: number): string => {
  const date = new Date(value - new Date(value).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};
const fromLocalInput = (value: string): number => new Date(value).getTime();
const safeBody = async (response: Response): Promise<unknown> => {
  try { return await response.json(); } catch { return null; }
};
const requestKey = (prefix: string, fingerprint: string): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}-${random}`.slice(0, 128);
};
const strategyVersion = (value: unknown): { id: string; configHash: string } | null => {
  if (!value || typeof value !== "object") return null;
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join(",") !== "idempotent,strategyVersion" || typeof root.idempotent !== "boolean") return null;
  const version = root.strategyVersion;
  if (!version || typeof version !== "object") return null;
  const record = version as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "configHash,createdAt,id,strategyId,version") return null;
  return typeof record.id === "string" && record.id.length > 0 && typeof record.strategyId === "string"
    && record.strategyId.length > 0 && Number.isSafeInteger(record.version) && Number(record.version) > 0
    && typeof record.configHash === "string" && /^[a-f0-9]{64}$/.test(record.configHash)
    && Number.isSafeInteger(record.createdAt) && Number(record.createdAt) >= 0
    ? { id: record.id, configHash: record.configHash } : null;
};

export function BacktestRequestForm({ config, compact = false, onRun, onVerifiedReport }: {
  config: BotConfig;
  compact?: boolean;
  onRun?: () => void;
  onVerifiedReport?: (evidence: FormalBacktestEvidence) => void;
}) {
  const fingerprint = backtestConfigFingerprint(config);
  return <BacktestRequestSession compact={compact} config={config} configFingerprint={fingerprint}
    key={fingerprint} onRun={onRun} onVerifiedReport={onVerifiedReport} />;
}

function BacktestRequestSession({ config, compact, configFingerprint, onRun, onVerifiedReport }: {
  config: BotConfig;
  compact: boolean;
  configFingerprint: string;
  onRun?: () => void;
  onVerifiedReport?: (evidence: FormalBacktestEvidence) => void;
}) {
  const configurationValid = validateConfig(config).valid;
  const [defaultRange] = useState(() => alignedRecentRange(config));
  const [start, setStart] = useState(toLocalInput(defaultRange.startTime));
  const [end, setEnd] = useState(toLocalInput(defaultRange.endTime));
  const [initialCapital, setInitialCapital] = useState("10000");
  const [feeRate, setFeeRate] = useState("0.001");
  const [slippageRate, setSlippageRate] = useState("0.0005");
  const [fundingMode, setFundingMode] = useState<"none" | "historical">(config.market === "futures" ? "historical" : "none");
  const [gapPolicy, setGapPolicy] = useState<"fail" | "disclose">("fail");
  const [state, setState] = useState<"idle" | "ensuring" | "running" | "done" | "error" | "unauthorized">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<HistoricalBacktestRecord | null>(null);
  const strategyAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const backtestAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  const clearEvidence = () => { setResult(null); setMessage(""); setState("idle"); };
  const change = <Value,>(setter: (value: Value) => void, value: Value) => {
    clearEvidence();
    strategyAttempt.current = null;
    backtestAttempt.current = null;
    setter(value);
  };
  const keyFor = (ref: typeof strategyAttempt, prefix: string, fingerprint: string): string => {
    if (ref.current?.fingerprint !== fingerprint) ref.current = { fingerprint, key: requestKey(prefix, fingerprint) };
    return ref.current.key;
  };

  const submit = async () => {
    if (!configurationValid || state === "ensuring" || state === "running") return;
    onRun?.();
    const startTime = fromLocalInput(start);
    const endTime = fromLocalInput(end);
    const interval = INTERVAL_MS[config.timeframe];
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !interval || startTime >= endTime
      || startTime % interval !== 0 || endTime % interval !== 0) {
      setState("error"); setMessage("開始與結束時間必須依策略週期對齊，且結束時間需晚於開始時間。"); return;
    }
    setResult(null); setMessage(""); setState("ensuring");
    try {
      const strategyKey = keyFor(strategyAttempt, "strategy", configFingerprint);
      const strategyResponse = await fetch("/api/strategies", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": strategyKey },
        body: JSON.stringify({ config }),
      });
      if (strategyResponse.status === 401) { setState("unauthorized"); return; }
      const strategyBody = await safeBody(strategyResponse);
      const version = strategyVersion(strategyBody);
      if (!strategyResponse.ok) {
        const strategyCode = strategyBody && typeof strategyBody === "object"
          ? (strategyBody as { error?: { code?: unknown } }).error?.code
          : undefined;
        throw new Error(strategyResponse.status >= 500
          ? "strategy_service_unavailable"
          : typeof strategyCode === "string" ? strategyCode : "strategy_version_failed");
      }
      if (version === null) throw new Error("strategy_version_failed");
      const effectiveGapPolicy = compact ? "fail" : gapPolicy;
      const request: HistoricalRequest = {
        strategyVersionId: version.id, market: config.market, symbol: config.symbol, interval: config.timeframe,
        startTime, endTime, initialCapital, feeRate, slippageRate, leverage: String(config.leverage),
        fundingMode: config.market === "futures" ? fundingMode : "none", gapPolicy: effectiveGapPolicy,
      };
      const backtestFingerprint = JSON.stringify(request);
      const backtestKey = keyFor(backtestAttempt, "historical", backtestFingerprint);
      setState("running");
      const response = await fetch("/api/backtests", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "Idempotency-Key": backtestKey },
        body: JSON.stringify(request),
      });
      if (response.status === 401) { setState("unauthorized"); return; }
      const body = await safeBody(response) as { backtest?: HistoricalBacktestRecord; error?: { code?: string } } | null;
      if (!response.ok || !body?.backtest) {
        const code = body?.error?.code ?? "";
        throw new Error(code || "backtest_failed");
      }
      const verified = onVerifiedReport && request.gapPolicy === "fail"
        ? formalBacktestToReport(body.backtest, config, version.configHash)
        : null;
      if (body.backtest.status === "succeeded" && onVerifiedReport && request.gapPolicy === "fail" && !verified) {
        throw new Error("strategy_integrity_failed");
      }
      setResult(body.backtest); setState(body.backtest.status === "failed" ? "error" : "done");
      if (body.backtest.status === "failed") setMessage(ERROR_MESSAGES[body.backtest.error?.code ?? ""] ?? "歷史回測未能完成。");
      else if (verified) onVerifiedReport?.(verified);
      strategyAttempt.current = null;
      backtestAttempt.current = null;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setState("error");
      setMessage(ERROR_MESSAGES[code] ?? (code === "strategy_version_failed" ? "無法建立不可變策略版本，請稍後重試。" : "歷史回測暫時無法執行，請稍後重試。"));
    }
  };

  return (
    <section className={`historical-request glass-panel${compact ? " historical-request--compact" : ""}`} aria-labelledby="historical-request-title" id="formal-backtest-request">
      <div className="workshop-panel__heading">
        <div><p className="eyebrow">PUBLIC MARKET DATA</p><h2 id="historical-request-title">進階歷史回測</h2></div>
        <span className="workshop-count">歷史證據</span>
      </div>
      <p className="historical-request__lead">使用公開歷史行情計算；不需要 API Key，也不會建立或送出訂單。</p>
      {config.source !== undefined && <p className="historical-notice" role="note">JavaScript 會在無網路、無檔案與無憑證權限的隔離沙箱中執行，回測結果會記錄程式碼雜湊。</p>}
      <fieldset className="historical-fields" disabled={state === "ensuring" || state === "running"}>
        <label><span>開始時間</span><input type="datetime-local" value={start} onChange={(event) => change(setStart, event.target.value)} /></label>
        <label><span>結束時間</span><input type="datetime-local" value={end} onChange={(event) => change(setEnd, event.target.value)} /></label>
        <label><span>初始資金（USDT）</span><input inputMode="decimal" min="1" max="100000000" step="100" type="number" value={initialCapital} onChange={(event) => change(setInitialCapital, event.target.value)} /></label>
        <label><span>手續費率</span><input inputMode="decimal" min="0" max="0.05" step="0.0001" type="number" value={feeRate} onChange={(event) => change(setFeeRate, event.target.value)} /></label>
        <label><span>滑價率</span><input inputMode="decimal" min="0" max="0.1" step="0.0001" type="number" value={slippageRate} onChange={(event) => change(setSlippageRate, event.target.value)} /></label>
        <label><span>資金費率</span><select disabled={config.market === "spot"} value={config.market === "spot" ? "none" : fundingMode} onChange={(event) => change(setFundingMode, event.target.value as "none" | "historical")}><option value="historical">歷史資金費率</option><option value="none">不計入</option></select></label>
        <label><span>資料缺口</span><select disabled={compact} value={compact ? "fail" : gapPolicy} onChange={(event) => change(setGapPolicy, event.target.value as "fail" | "disclose")}><option value="fail">遇缺口即停止</option>{!compact && <option value="disclose">揭露缺口並繼續</option>}</select></label>
        <div className="historical-config"><span>市場 / 槓桿</span><strong>{config.symbol} · {config.market === "spot" ? "現貨" : "合約"} · {config.leverage}×</strong></div>
      </fieldset>
      <button className="button button--primary historical-submit" disabled={!configurationValid || state === "ensuring" || state === "running"} onClick={submit} type="button">
        {state === "ensuring" ? "固定策略版本中…" : state === "running" ? "取得行情並計算中…" : "執行進階歷史回測"}
      </button>
      <div aria-live="polite">
        {state === "unauthorized" && <p className="historical-feedback">請先登入，才能保存並查看自己的歷史回測。 <Link href={compact ? "/auth?return_to=%2Fworkshop" : "/auth?return_to=%2Fbacktests"}>登入</Link></p>}
        {state === "error" && message && <p className="historical-feedback historical-feedback--error">{message}</p>}
      </div>
      {result && <>
        <BacktestResultCard backtest={result} />
        {config.source === undefined
          ? <CreateRunPanel backtest={result} config={config} />
          : <p className="historical-notice" role="note">自訂 JavaScript 已完成隔離沙箱回測；目前雲端 Executor 只支援視覺策略，因此不會顯示雲端啟動入口。</p>}
      </>}
    </section>
  );
}
