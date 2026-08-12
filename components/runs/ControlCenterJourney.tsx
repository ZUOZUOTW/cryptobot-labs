"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  FiArrowRight,
  FiCheck,
  FiEdit3,
  FiGlobe,
  FiLink,
  FiPlayCircle,
  FiRefreshCw,
  FiShield,
} from "react-icons/fi";
import { loadDraft } from "@/lib/storage";

type PublicationState = "disabled" | "loading" | "ready" | "unauthorized" | "error";

interface OwnedPublicationSummary {
  count: number;
  latest: { slug: string; name: string; publishedAt: number } | null;
}

interface LocalDraftSummary {
  name: string;
  symbol: string;
  timeframe: string;
}

interface ControlCenterJourneyProps {
  connected: boolean;
  connectionStatus: "active" | "pending" | "processing" | "reauthorization_required" | "revoked" | "error" | null;
  loadOwnedPublications?: boolean;
  runCount: number;
  synchronized: boolean;
}

const PUBLICATION_SLUG = /^[a-z0-9][a-z0-9-]{7,79}$/;

export function parseOwnedPublicationSummary(value: unknown): OwnedPublicationSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const publications = (value as { publications?: unknown }).publications;
  if (!Array.isArray(publications) || publications.length > 100) return null;
  const parsed: NonNullable<OwnedPublicationSummary["latest"]>[] = [];
  for (const candidate of publications) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    if (typeof row.slug !== "string" || !PUBLICATION_SLUG.test(row.slug)
      || typeof row.name !== "string" || row.name.trim().length < 1 || row.name.length > 120
      || !Number.isSafeInteger(row.publishedAt) || Number(row.publishedAt) < 0) return null;
    parsed.push({ slug: row.slug, name: row.name.trim(), publishedAt: row.publishedAt as number });
  }
  parsed.sort((left, right) => right.publishedAt - left.publishedAt);
  return { count: parsed.length, latest: parsed[0] ?? null };
}

const publicationLabel = (
  state: PublicationState,
  summary: OwnedPublicationSummary | null,
): { detail: string; status: string } => {
  if (state === "ready") return summary?.count
    ? { status: `${summary.count} 個已發布`, detail: "已出現在探索策略列表，可繼續分享或更新版本。" }
    : { status: "尚未發布", detail: "完成歷史回測與訊號流程測試後，即可公開分享。" };
  if (state === "loading") return { status: "正在同步", detail: "正在確認會員工作區的公開版本。" };
  if (state === "unauthorized") return { status: "登入後查看", detail: "登入狀態過期，控制台未推測發布數量。" };
  if (state === "error") return { status: "暫時無法確認", detail: "發布資料未載入，不以預設數量替代。" };
  return { status: "未在此預覽載入", detail: "正式控制台會同步會員已發布策略。" };
};

export function ControlCenterJourney({
  connected,
  connectionStatus,
  loadOwnedPublications = true,
  runCount,
  synchronized,
}: ControlCenterJourneyProps) {
  const [draft, setDraft] = useState<LocalDraftSummary | null | undefined>(undefined);
  const [publicationState, setPublicationState] = useState<PublicationState>(
    loadOwnedPublications ? "loading" : "disabled",
  );
  const [publications, setPublications] = useState<OwnedPublicationSummary | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadDraft();
      setDraft(saved ? { name: saved.name, symbol: saved.symbol, timeframe: saved.timeframe } : null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loadOwnedPublications) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/strategy-publications/mine", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }).then(async (response) => {
        if (response.status === 401) {
          setPublicationState("unauthorized");
          return;
        }
        const parsed = parseOwnedPublicationSummary(await response.json());
        if (!response.ok || !parsed) throw new Error("invalid_owned_publications");
        setPublications(parsed);
        setPublicationState("ready");
      }).catch((error: unknown) => {
        if ((error as { name?: unknown })?.name !== "AbortError") setPublicationState("error");
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadOwnedPublications]);

  const next = useMemo(() => {
    if (connectionStatus === "pending" || connectionStatus === "processing") return {
      action: "查看連線進度",
      body: "WEEX 連線仍在驗證中；權限確認前不會載入帳戶數值或建立交易。",
      href: "/connections",
      title: "完成 WEEX 連線驗證",
    };
    if (connectionStatus === "reauthorization_required" || connectionStatus === "revoked" || connectionStatus === "error") return {
      action: "修復 WEEX 連線",
      body: "目前授權不可用；重新驗證 API 權限與白名單後，控制台才會恢復同步。",
      href: "/connections",
      title: "先恢復安全連線",
    };
    if (!connected) return {
      action: "開始安全連線",
      body: "先完成唯讀與交易權限驗證；密鑰不會顯示在控制台。",
      href: "/connections",
      title: "先建立安全連線",
    };
    if (!synchronized) return {
      action: "檢查同步狀態",
      body: "連線已建立，但第一筆可信帳戶快照尚未抵達；等待期間不顯示推測權益。",
      href: "/connections",
      title: "等待 Executor 安全快照",
    };
    if (runCount === 0) return {
      action: "選擇策略並設定風控",
      body: "啟動流程會先固定版本、完成歷史行情回測，再套用曝險與單日虧損上限。",
      href: "/runs/new",
      title: "啟動第一個受保護的策略",
    };
    return {
      action: "查看執行證據",
      body: "策略已運行；前往活動紀錄核對評估、訊號與風控決策。",
      href: "/activity",
      title: "持續核對策略證據",
    };
  }, [connected, connectionStatus, runCount, synchronized]);
  const publication = publicationLabel(publicationState, publications);

  const steps = [
    {
      complete: connected,
      current: !connected,
      detail: connected ? "WEEX 權限已驗證" : connectionStatus === "pending" || connectionStatus === "processing"
        ? "正在驗證 WEEX 權限" : "尚未連接 WEEX",
      icon: FiLink,
      label: "安全連線",
    },
    {
      complete: synchronized,
      current: connected && !synchronized,
      detail: synchronized ? "可信帳戶快照已就緒" : "等待 Executor 快照",
      icon: FiRefreshCw,
      label: "資料同步",
    },
    {
      complete: runCount > 0,
      current: synchronized && runCount === 0,
      detail: runCount > 0 ? `${runCount} 個策略已建立` : "啟動時必須設定風控",
      icon: FiShield,
      label: "策略與風控",
    },
    {
      complete: runCount > 0,
      current: false,
      detail: runCount > 0 ? "活動與訊號持續留痕" : "運行後開始記錄",
      icon: FiPlayCircle,
      label: "執行證據",
    },
  ];

  return (
    <section className="control-center-journey glass-panel" aria-labelledby="control-center-journey-title">
      <div className="control-center-journey__next">
        <p className="eyebrow">建議下一步</p>
        <h2 id="control-center-journey-title">{next.title}</h2>
        <p>{next.body}</p>
        <Link className="button button--primary" href={next.href}>{next.action}<FiArrowRight aria-hidden="true" /></Link>
      </div>

      <ol className="control-center-journey__steps" aria-label="控制中心啟用進度">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const state = step.complete ? "complete" : step.current ? "current" : "pending";
          return <li aria-current={step.current ? "step" : undefined} data-state={state} key={step.label}>
            <span aria-hidden="true">{step.complete ? <FiCheck /> : <Icon />}</span>
            <div><small>0{index + 1}</small><strong>{step.label}</strong><em>{step.detail}</em></div>
          </li>;
        })}
      </ol>

      <div className="control-center-workspace" aria-label="策略工作區摘要">
        <article>
          <span aria-hidden="true"><FiEdit3 /></span>
          <div><small>策略草稿</small><strong>{draft === undefined ? "正在檢查本機草稿" : draft ? draft.name : "尚未建立草稿"}</strong>
            <p>{draft ? `${draft.symbol} · ${draft.timeframe}，保存在這個瀏覽器。` : "從積木、參數或程式碼開始組裝策略。"}</p></div>
          <Link aria-label={draft ? `繼續編輯 ${draft.name}` : "建立策略草稿"} className="button button--ghost button--small" href="/workshop">
            {draft ? "繼續編輯" : "建立草稿"}
          </Link>
        </article>
        <article>
          <span aria-hidden="true"><FiGlobe /></span>
          <div><small>探索策略發布</small><strong>{publication.status}</strong><p>{publication.detail}</p></div>
          {publications?.latest ? <Link aria-label={`查看已發布策略 ${publications.latest.name}`}
            className="button button--ghost button--small" href={`/strategies/${encodeURIComponent(publications.latest.slug)}`}>
            查看最新
          </Link> : <Link className="button button--ghost button--small" href="/workshop">前往發布</Link>}
        </article>
      </div>
    </section>
  );
}
