"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseActivityList } from "./activity-parser";
import type { ActivityActor, ActivityItem } from "./types";

type LoadState = "loading" | "ready" | "error" | "unauthorized";
type MoreState = "idle" | "loading" | "error";

const localTimestamp = (value: number) => new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium", timeStyle: "medium",
}).format(new Date(value));
const hashPreview = (value: string | null) => value ? `${value.slice(0, 12)}…` : "—";
const shown = (value: string | null) => value ?? "—";
const actorLabel = (value: ActivityActor) => value === "device" ? "裝置" : "使用者";
const epoch = (value: string) => value ? new Date(value).getTime() : null;

export function ActivityTable() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [moreState, setMoreState] = useState<MoreState>("idle");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [range, setRange] = useState<{ from: number | null; to: number | null }>({ from: null, to: null });
  const [actor, setActor] = useState<"all" | ActivityActor>("all");
  const [keyword, setKeyword] = useState("");
  const [filterError, setFilterError] = useState("");

  const query = useCallback((cursor: string | null, format?: "csv" | "json") => {
    const params = new URLSearchParams();
    if (format) params.set("format", format);
    params.set("limit", format ? "100" : "50");
    if (range.from !== null) params.set("from", String(range.from));
    if (range.to !== null) params.set("to", String(range.to));
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [range]);

  const load = useCallback(async (cursor: string | null = null) => {
    const append = cursor !== null;
    if (append) setMoreState("loading"); else setState("loading");
    try {
      const response = await fetch(`/api/activity?${query(cursor)}`, { cache: "no-store", headers: { Accept: "application/json" } });
      if (response.status === 401) { setItems([]); setNextCursor(null); setState("unauthorized"); return; }
      const parsed = parseActivityList(await response.json());
      if (!response.ok || !parsed) throw new Error("invalid_activity_list");
      setItems((current) => append
        ? [...current, ...parsed.items.filter(({ id }) => !current.some((item) => item.id === id))]
        : parsed.items);
      setNextCursor(parsed.nextCursor);
      setState("ready"); setMoreState("idle");
    } catch {
      if (append) setMoreState("error"); else { setItems([]); setNextCursor(null); setState("error"); }
    }
  }, [query]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const applyRange = () => {
    const from = epoch(fromInput); const to = epoch(toInput);
    if ((fromInput && (from === null || !Number.isFinite(from))) || (toInput && (to === null || !Number.isFinite(to)))) {
      setFilterError("請輸入有效的開始與結束時間。"); return;
    }
    if (from !== null && to !== null && from > to) { setFilterError("開始時間不可晚於結束時間。"); return; }
    setFilterError(""); setRange({ from, to });
  };

  const visibleItems = useMemo(() => {
    const needle = keyword.trim().toLocaleLowerCase();
    return items.filter((item) => (actor === "all" || item.actorType === actor)
      && (!needle || [item.type, item.deviceId, item.deploymentId, item.strategyVersionId, item.reason,
        item.riskDecision, item.clientOrderId, item.exchangeOrderId, item.status, item.correlationId]
        .some((value) => value?.toLocaleLowerCase().includes(needle))));
  }, [actor, items, keyword]);

  return (
    <section className="activity-panel" aria-labelledby="activity-title">
      <div className="activity-panel__heading">
        <div><p className="eyebrow">APPEND-ONLY EVIDENCE</p><h2 id="activity-title">活動時間軸</h2></div>
        <button className="button button--ghost button--small" onClick={() => void load()} type="button">重新整理</button>
      </div>

      <div className="activity-controls glass-panel">
        <label><span>開始時間</span><input aria-label="開始時間" onChange={(event) => setFromInput(event.target.value)} type="datetime-local" value={fromInput} /></label>
        <label><span>結束時間</span><input aria-label="結束時間" onChange={(event) => setToInput(event.target.value)} type="datetime-local" value={toInput} /></label>
        <button className="button button--secondary button--small" onClick={applyRange} type="button">套用時間範圍</button>
        <label><span>操作者</span><select aria-label="操作者" onChange={(event) => setActor(event.target.value as "all" | ActivityActor)} value={actor}><option value="all">所有操作者</option><option value="user">使用者</option><option value="device">裝置</option></select></label>
        <label className="activity-controls__search"><span>篩選已載入紀錄</span><input aria-label="篩選已載入紀錄" onChange={(event) => setKeyword(event.target.value)} placeholder="事件、訂單或 correlation ID" type="search" value={keyword} /></label>
      </div>
      {filterError && <p className="activity-filter-error" role="alert">{filterError}</p>}

      <div className="activity-export-row">
        <p role="note">CSV 與 JSON 匯出採用目前時間範圍；匯出檔不包含 API 憑證、Secret 或 Passphrase。</p>
        <div className="button-row">
          <a className="button button--ghost button--small" href={`/api/activity/export?${query(null, "csv")}`}>匯出 CSV</a>
          <a className="button button--ghost button--small" href={`/api/activity/export?${query(null, "json")}`}>匯出 JSON</a>
        </div>
      </div>

      <div aria-live="polite">
        {state === "loading" && <p className="activity-empty">正在載入活動紀錄…</p>}
        {state === "error" && <div className="activity-empty"><p>無法載入活動紀錄。</p><button className="button button--secondary button--small" onClick={() => void load()} type="button">重試載入</button></div>}
        {state === "unauthorized" && <p className="activity-empty">登入狀態已過期。 <Link href="/signin-with-chatgpt?return_to=%2Factivity">使用 ChatGPT 重新登入</Link></p>}
        {state === "ready" && visibleItems.length === 0 && <p className="activity-empty">尚無符合條件的活動紀錄。活動會在代理配對、策略運行與風險判斷後出現。</p>}
      </div>

      {state === "ready" && visibleItems.length > 0 && <div className="activity-table-shell table-shell glass-panel">
        <table className="activity-table">
          <caption className="sr-only">活動稽核與交易證據</caption>
          <thead><tr><th scope="col">時間</th><th scope="col">事件 / actor</th><th scope="col">版本證據</th><th scope="col">原因 / 風險</th><th scope="col">訂單</th><th scope="col">狀態 / 追蹤</th></tr></thead>
          <tbody>{visibleItems.map((item) => <tr key={item.id}>
            <td className="activity-time"><time dateTime={new Date(item.occurredAt).toISOString()}><strong>UTC</strong> {new Date(item.occurredAt).toISOString()}</time><span><strong>本地</strong> {localTimestamp(item.occurredAt)}</span></td>
            <th scope="row"><strong>{item.type}</strong><span>{item.actorType === "device" ? `${actorLabel(item.actorType)} · ${item.deviceId ?? "未知裝置"}` : "使用者 · 網站"}</span>{item.actorType === "user" && item.deviceId && <span>目標裝置 {item.deviceId}</span>}<span>事件 {item.id}</span></th>
            <td><span>運行 {item.deploymentId ? `${item.deploymentId} · ${item.deploymentVersion ? `v${item.deploymentVersion}` : "版本證據缺少"}` : "—"}</span><span>策略 {item.strategyVersionId ? `${item.strategyVersionId} · ${item.strategyVersion ? `v${item.strategyVersion}` : "版本證據缺少"}` : "—"}</span><span title={item.configurationHash ?? undefined}>設定 {hashPreview(item.configurationHash)}</span><span title={item.scriptHash ?? undefined}>腳本 {hashPreview(item.scriptHash)}</span></td>
            <td><span>原因 {shown(item.reason)}</span><span>風險判斷 {shown(item.riskDecision)}</span></td>
            <td><span>Client {shown(item.clientOrderId)}</span><span>WEEX {shown(item.exchangeOrderId)}</span></td>
            <td><span className="activity-status">{shown(item.status)}</span><span>Correlation {item.correlationId}</span></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {state === "ready" && nextCursor && <button className="button button--secondary activity-more" disabled={moreState === "loading"} onClick={() => void load(nextCursor)} type="button">{moreState === "loading" ? "載入更多中…" : moreState === "error" ? "重試載入更多" : "載入更多"}</button>}
    </section>
  );
}
