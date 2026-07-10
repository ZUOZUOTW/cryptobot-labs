"use client";

import { useMemo } from "react";
import { validateJavaScript } from "../../lib/strategy-validation";

export const WEEX_JAVASCRIPT_TEMPLATE = [
  "/**",
  " * CryptoBot Labs 的 WEEX 模擬策略範例。",
  " * 原始碼只會被靜態檢查，不會在瀏覽器中執行。",
  " */",
  "export const strategy = {",
  "  exchange: \"WEEX\",",
  "  market: \"spot\",",
  "  symbol: \"BTCUSDT\",",
  "  timeframe: \"1h\",",
  "  signal: \"SMA crossover\"",
  "};",
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

      <p className="javascript-editor__lead">原始碼只作文字驗證與套件保存；這個頁面不會執行、載入或連線至任何交易程式。</p>
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
