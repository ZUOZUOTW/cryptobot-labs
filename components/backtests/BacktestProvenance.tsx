"use client";

import { useI18n } from "@/components/I18nProvider";
import type { HistoricalBacktestRecord } from "./BacktestResultCard";

const shortHash = (value: string | null | undefined): string => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : "—";

export function BacktestProvenance({ backtest }: { backtest: HistoricalBacktestRecord }) {
  const { locale } = useI18n();
  const dateTime = (value: number | null | undefined): string => (
    typeof value === "number" && Number.isFinite(value)
      ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value)
      : "—"
  );
  const provenance = backtest.result?.provenance;
  const dataset = backtest.dataset;
  if (!provenance || !dataset) return null;

  return (
    <section className="historical-provenance" aria-labelledby={`provenance-${backtest.id}`}>
      <h3 id={`provenance-${backtest.id}`}>資料與模型溯源</h3>
      <dl>
        <div><dt>要求區間（UTC）</dt><dd>{dateTime(dataset.requestedStartAt)} — {dateTime(dataset.requestedEndAt)}</dd></div>
        <div><dt>取得區間（UTC）</dt><dd>{dateTime(dataset.actualStartAt)} — {dateTime(dataset.actualEndAt)}</dd></div>
        <div><dt>資料品質</dt><dd>{provenance.complete ? "完整資料" : "資料不完整"} · 資料缺口 {provenance.gapCount} · 重複 {provenance.duplicateCount} · 未完成 {provenance.incompleteCount}</dd></div>
        <div><dt>交易成本</dt><dd>手續費 {provenance.feeRate} · 滑價 {provenance.slippageRate}</dd></div>
        <div><dt>資金費率</dt><dd>{provenance.fundingTreatment.appliedEvents} / {provenance.fundingTreatment.suppliedEvents} 筆 · 淨額 {provenance.fundingTreatment.netFunding} · {provenance.fundingTreatment.convention}</dd></div>
        <div><dt>策略訊號 / 成交 / 風控</dt><dd>訊號：完成 K 線收盤（{provenance.executionConvention.signalEvaluation}）· 成交：下一根開盤（{provenance.executionConvention.signalExecution}）· 策略風控：僅收盤價、非盤中（{provenance.executionConvention.riskTrigger}）</dd></div>
        <div><dt>清算價格檢查</dt><dd>清算另採盤中極值：資金費率事件標記價格立即檢查，再以 K 線最低價檢查多倉、最高價檢查空倉（{provenance.liquidationModel.check}）</dd></div>
        <div><dt>資金費率 / 清算順序</dt><dd>資金費率在事件時間先套用，再檢查該根 K 線不利盤中極值（{provenance.liquidationModel.orderingAssumption}）</dd></div>
        <div><dt>MMR / 最大槓桿</dt><dd>固定維持保證金率 {provenance.liquidationModel.maintenanceMarginRate} · 模型上限 {provenance.liquidationModel.maximumSupportedLeverage}× · 固定保守估算模型（{provenance.liquidationModel.model}）</dd></div>
        <div><dt>引擎版本</dt><dd><code>{provenance.engineVersion}</code></dd></div>
        <div><dt>設定雜湊</dt><dd><code title={provenance.configHash}>{shortHash(provenance.configHash)}</code></dd></div>
        <div><dt>策略雜湊</dt><dd><code title={provenance.strategyHash}>{shortHash(provenance.strategyHash)}</code></dd></div>
        <div><dt>資料集雜湊</dt><dd><code title={provenance.datasetDigest}>{shortHash(provenance.datasetDigest)}</code></dd></div>
      </dl>
    </section>
  );
}
