"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BacktestResultCard, requestOf } from "./BacktestResultCard";
import type { HistoricalBacktestRecord, HistoricalBacktestStatus } from "./BacktestResultCard";
import { useI18n } from "@/components/I18nProvider";

const STATUS: Record<HistoricalBacktestStatus, string> = {
  queued: "排隊中", "fetching-data": "取得行情中", running: "計算中", succeeded: "已完成", failed: "失敗",
};
const SAFE_ERRORS: Record<string, string> = {
  data_fetch_failed: "公開行情暫時無法取得",
  historical_dataset_incomplete: "歷史行情資料不完整",
  historical_funding_incomplete: "歷史資金費率資料不完整",
  backtest_execution_failed: "回測計算未完成",
  invalid_historical_range: "回測區間無效",
};
const validList = (value: unknown): value is { items: HistoricalBacktestRecord[]; nextCursor: string | null } => (
  !!value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
  && (typeof (value as { nextCursor?: unknown }).nextCursor === "string" || (value as { nextCursor?: unknown }).nextCursor === null)
);

export function BacktestHistory() {
  const { locale } = useI18n();
  const [items, setItems] = useState<HistoricalBacktestRecord[]>([]);
  const [selected, setSelected] = useState<HistoricalBacktestRecord | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "unauthorized">("loading");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [moreState, setMoreState] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState("");

  const load = useCallback(async (cursor: string | null = null) => {
    const append = cursor !== null;
    if (append) setMoreState("loading");
    else setState("loading");
    try {
      const url = cursor === null ? "/api/backtests?limit=20" : `/api/backtests?limit=20&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setState("unauthorized"); return; }
      const body: unknown = await response.json();
      if (!response.ok || !validList(body)) throw new Error("list_failed");
      setItems((current) => {
        const ids = new Set(append ? current.map(({ id }) => id) : []);
        const uniquePage = body.items.filter(({ id }) => {
          if (ids.has(id)) return false;
          ids.add(id);
          return true;
        });
        return append ? [...current, ...uniquePage] : uniquePage;
      });
      setNextCursor(body.nextCursor);
      setMoreState("idle");
      setState("ready");
    } catch {
      if (append) setMoreState("error");
      else setState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadDetail = async (id: string) => {
    setDetailError("");
    try {
      const response = await fetch(`/api/backtests/${encodeURIComponent(id)}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setState("unauthorized"); return; }
      const body = await response.json() as { backtest?: HistoricalBacktestRecord };
      if (!response.ok || !body.backtest) throw new Error("detail_failed");
      setSelected(body.backtest);
    } catch { setDetailError("無法載入這筆回測的完整結果，請稍後重試。"); }
  };

  return (
    <section className="backtest-history" aria-labelledby="backtest-history-title">
      <div className="backtest-history__heading"><div><p className="eyebrow">YOUR EVIDENCE LOG</p><h2 id="backtest-history-title">我的歷史回測</h2></div>{state === "ready" && <button className="button button--ghost button--small" onClick={() => void load(null)} type="button">重新整理</button>}</div>
      <div aria-live="polite">
        {state === "loading" && <p className="historical-empty">正在載入你的歷史回測…</p>}
        {state === "error" && <div className="historical-empty"><p>無法載入歷史回測。</p><button className="button button--secondary" onClick={() => void load(null)} type="button" aria-label="重試載入">重試載入</button></div>}
        {state === "unauthorized" && <p className="historical-empty">登入狀態已過期。 <Link href="/auth?return_to=%2Fbacktests">重新登入</Link></p>}
        {state === "ready" && items.length === 0 && <p className="historical-empty">尚無歷史回測。先到組裝車間選擇策略，再建立第一份行情證據。</p>}
      </div>
      {state === "ready" && items.length > 0 && (
        <ul className="history-list" aria-label="歷史回測紀錄">
          {items.map((item) => {
            const request = requestOf(item);
            const code = item.error?.code ?? item.errorCode ?? "";
            return <li key={item.id}>
              <div><strong>{request?.symbol ?? "交易策略"}</strong><span>{request?.interval ?? "—"} · {request?.market === "futures" ? "合約" : "現貨"}</span></div>
              <div><span className={`history-status history-status--${item.status}`}>{STATUS[item.status]}</span><time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(item.createdAt)}</time></div>
              {item.status === "failed" && <p>{SAFE_ERRORS[code] ?? "此回測未能完成"}</p>}
              {item.status === "succeeded" && <button className="button button--ghost button--small" onClick={() => void loadDetail(item.id)} type="button">查看完整結果</button>}
            </li>;
          })}
        </ul>
      )}
      {detailError && <p className="historical-feedback historical-feedback--error" role="alert">{detailError}</p>}
      {state === "ready" && nextCursor !== null && moreState !== "error" && <button className="button button--secondary history-more" disabled={moreState === "loading"} onClick={() => void load(nextCursor)} type="button">{moreState === "loading" ? "載入更多中…" : "載入更多"}</button>}
      {state === "ready" && nextCursor !== null && moreState === "error" && <div className="historical-feedback historical-feedback--error"><p>無法載入更多歷史回測，現有紀錄仍保留。</p><button className="button button--secondary" onClick={() => void load(nextCursor)} type="button">重試載入更多</button></div>}
      {selected && <BacktestResultCard backtest={selected} />}
    </section>
  );
}
