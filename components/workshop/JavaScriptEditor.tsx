"use client";

import { useMemo } from "react";
import { validateJavaScript } from "../../lib/strategy-validation";
import type { BotConfig } from "../../lib/types";

export const createWeexJavaScriptTemplate = (config: Pick<BotConfig, "market" | "symbol" | "timeframe">) => [
  "/**",
  " * CryptoBot Labs 的 WEEX 模擬策略範例。",
  " * 回測與本機代理只會在隔離沙箱中執行此函式。",
  " */",
  "export const strategy = {",
  "  exchange: \"WEEX\",",
  `  market: ${JSON.stringify(config.market)},`,
  `  symbol: ${JSON.stringify(config.symbol)},`,
  `  timeframe: ${JSON.stringify(config.timeframe)},`,
  "  signal: \"SMA crossover\"",
  "};",
  "",
  "export default function evaluate(input) {",
  "  const candles = input.candles;",
  "  if (candles.length < 2) return { action: \"hold\", reason: \"waiting-for-candles\" };",
  "  const previous = Number(candles[candles.length - 2].close);",
  "  const current = Number(candles[candles.length - 1].close);",
  "  if (current > previous) return { action: \"buy\", reason: \"close-rising\", allocationRate: 0.1 };",
  "  if (current < previous) return { action: \"sell\", reason: \"close-falling\", allocationRate: 0.1 };",
  "  return { action: \"hold\", reason: \"close-unchanged\" };",
  "}",
  "",
].join("\n");

interface JavaScriptEditorProps {
  source: string;
  onChange: (source: string) => void;
}

const quotedValue = (source: string, field: string): string | undefined => {
  const match = source.match(new RegExp(`${field}\\s*:\\s*["']([^"']+)["']`, "i"));
  return match?.[1];
};

export function JavaScriptEditor({ source, onChange }: JavaScriptEditorProps) {
  const validation = useMemo(() => validateJavaScript(source), [source]);
  const lineCount = source === "" ? 0 : source.split(/\r\n|\r|\n/).length;
  const exchange = quotedValue(source, "exchange") ?? (source.match(/\bWEEX\b/i) ? "WEEX" : "未標示");
  const symbol = quotedValue(source, "symbol") ?? "沿用表單設定";
  const timeframe = quotedValue(source, "timeframe") ?? "沿用表單設定";

  return (
    <section className="workshop-panel javascript-editor glass-panel" aria-labelledby="javascript-editor-title">
      <div className="workshop-panel__heading">
        <div>
          <p className="eyebrow">01 / INERT SOURCE</p>
          <h2 id="javascript-editor-title">JavaScript 策略</h2>
        </div>
        <span className={`validation-badge ${validation.valid ? "is-valid" : "is-invalid"}`}>
          {validation.valid ? "STATIC PASS" : "BLOCKED"}
        </span>
      </div>

      <p className="javascript-editor__lead">此頁不執行程式碼；歷史回測與本機代理只會在無網路、無檔案及無 API Key 權限的隔離沙箱中執行，輸出只能是交易訊號。</p>
      <label className="javascript-editor__field" htmlFor="javascript-strategy-source">
        <span>JavaScript 策略原始碼</span>
        <textarea
          id="javascript-strategy-source"
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          value={source}
        />
      </label>
      <div className="javascript-editor__meta">
        <span>{lineCount} 行程式碼</span>
        <span>{validation.valid ? "靜態檢查通過" : "請修正後再回測"}</span>
      </div>

      {validation.errors.length > 0 && (
        <div className="javascript-editor__errors" role="alert">
          {validation.errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      <section className="javascript-preview" aria-label="程式碼靜態預覽">
        <h3>白話預覽</h3>
        <p>系統只讀取可辨識的文字欄位，不會執行程式碼。</p>
        <dl>
          <div><dt>交易所</dt><dd>{exchange}</dd></div>
          <div><dt>交易對</dt><dd>{symbol}</dd></div>
          <div><dt>週期</dt><dd>{timeframe}</dd></div>
        </dl>
      </section>
    </section>
  );
}
