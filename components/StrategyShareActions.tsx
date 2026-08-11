"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiCopy, FiDownload, FiExternalLink, FiImage, FiLink, FiShare2, FiX } from "react-icons/fi";
import {
  buildStrategyShareText,
  socialShareUrl,
  strategyPosterFilename,
  strategyPosterPath,
  type StrategyShareNetwork,
  type VerifiedSharePerformance,
} from "../lib/strategy-sharing";
import { sanitizeStrategyDisplayText } from "../lib/strategy-name";
import type { Market, RiskLevel } from "../lib/types";
import { useI18n } from "./I18nProvider";
import styles from "./StrategyShareActions.module.css";

export interface StrategyShareActionsProps {
  botId: string;
  botName: string;
  sharePath?: string;
  posterPath?: string;
  via?: string;
  market?: string;
  marketKind?: Market;
  timeframe?: string;
  risk?: string;
  riskLevel?: RiskLevel;
  verifiedPerformance?: VerifiedSharePerformance;
}

type PosterPreparation = "idle" | "loading" | "ready" | "unavailable";

const NETWORK_LABELS: Record<StrategyShareNetwork, string> = {
  line: "LINE",
  x: "X",
  facebook: "Facebook",
  telegram: "Telegram",
};

const isAbortError = (error: unknown): boolean => (
  error instanceof DOMException && error.name === "AbortError"
);

export function StrategyShareActions({
  botId,
  botName,
  sharePath,
  posterPath,
  via,
  market,
  marketKind,
  timeframe,
  risk,
  riskLevel,
  verifiedPerformance,
}: StrategyShareActionsProps) {
  const { locale } = useI18n();
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [posterPreparation, setPosterPreparation] = useState<PosterPreparation>("idle");
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const preparedPosterRef = useRef<File | null>(null);
  const resolvedSharePath = sharePath ?? `/bots/${encodeURIComponent(botId)}`;
  const resolvedPosterPath = posterPath ?? strategyPosterPath(resolvedSharePath);
  const safeBotName = useMemo(() => sanitizeStrategyDisplayText(botName), [botName]);
  const shareText = useMemo(() => buildStrategyShareText({
    name: safeBotName,
    market,
    marketKind,
    timeframe,
    risk,
    riskLevel,
    verifiedPerformance,
  }, locale), [locale, market, marketKind, risk, riskLevel, safeBotName, timeframe, verifiedPerformance]);

  const shareUrl = () => {
    const url = new URL(resolvedSharePath, window.location.origin);
    if (via) url.searchParams.set("via", via);
    return url.toString();
  };

  const posterUrl = useCallback(() => {
    const url = new URL(resolvedPosterPath, window.location.origin);
    if (url.origin !== window.location.origin) throw new Error("poster URL must be same-origin");
    return url.toString();
  }, [resolvedPosterPath]);

  const fetchPosterFile = useCallback(async (): Promise<File> => {
    const response = await fetch(posterUrl(), { cache: "force-cache", credentials: "same-origin" });
    if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "image/png") {
      throw new Error(`poster request failed (${response.status})`);
    }
    const blob = await response.blob();
    if (blob.size > 5_000_000) throw new Error("poster file is too large");
    return new File([blob], strategyPosterFilename(botId), { type: "image/png" });
  }, [botId, posterUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        setPosterPreparation("idle");
        window.requestAnimationFrame(() => triggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !navigator.share || typeof navigator.canShare !== "function") return;

    let active = true;
    void fetchPosterFile().then((file) => {
      if (!active) return;
      let supported = false;
      try {
        supported = navigator.canShare?.({ files: [file] }) ?? false;
      } catch {
        supported = false;
      }
      if (supported) {
        preparedPosterRef.current = file;
        setPosterPreparation("ready");
      } else {
        setPosterPreparation("unavailable");
      }
    }).catch(() => {
      if (active) setPosterPreparation("unavailable");
    });
    return () => {
      active = false;
    };
  }, [fetchPosterFile, isOpen]);

  const closeDialog = () => {
    setIsOpen(false);
    setPosterPreparation("idle");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openDialog = () => {
    preparedPosterRef.current = null;
    const runtimeNavigator = navigator as unknown as { share?: unknown; canShare?: unknown };
    setPosterPreparation(typeof runtimeNavigator.share === "function" && typeof runtimeNavigator.canShare === "function"
      ? "loading"
      : "unavailable");
    setIsOpen(true);
  };

  const copyValue = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
      return true;
    } catch {
      setMessage("無法自動複製，請在海報視窗中手動選取文案或連結。");
      return false;
    }
  };

  const copyLink = async () => {
    await copyValue(shareUrl(), "分享連結已複製");
  };

  const copyCaption = async () => {
    await copyValue(shareText, "分享文案已複製");
  };

  const openSocialShare = (network: StrategyShareNetwork) => {
    const target = socialShareUrl(network, { text: shareText, url: shareUrl() });
    window.open(target, "_blank", "noopener,noreferrer");
    setMessage(`已開啟 ${NETWORK_LABELS[network]}；文案與動態海報預覽會由分享連結帶入。`);
  };

  const shareWithSystem = () => {
    if (!navigator.share) {
      void copyValue(`${shareText}\n${shareUrl()}`, "裝置不支援系統分享；文案與連結已複製。");
      return;
    }

    const baseShareData: ShareData = {
      title: `${safeBotName || "Strategy"}｜CryptoBot Labs`,
      text: shareText,
      url: shareUrl(),
    };
    let shareData = baseShareData;
    const preparedPoster = preparedPosterRef.current;
    if (preparedPoster && typeof navigator.canShare === "function") {
      const fileShareData: ShareData = { ...baseShareData, files: [preparedPoster] };
      try {
        if (navigator.canShare(fileShareData)) shareData = fileShareData;
      } catch {
        // Fall through to an immediate text/link share while activation is live.
      }
    }

    let shareRequest: Promise<void>;
    try {
      setIsBusy(true);
      shareRequest = navigator.share(shareData);
    } catch (error) {
      setMessage(isAbortError(error) ? "已取消分享。" : "系統分享未完成，請改用下方社群按鈕。");
      setIsBusy(false);
      return;
    }
    void shareRequest.then(() => {
      setMessage(shareData.files?.length ? "已完成分享，海報 PNG 已一併附上。" : "已完成系統分享。");
    }).catch((error: unknown) => {
      setMessage(isAbortError(error) ? "已取消分享。" : "系統分享未完成，請改用下方社群按鈕。");
    }).finally(() => setIsBusy(false));
  };

  const downloadPoster = async () => {
    setIsBusy(true);
    let objectUrl: string | null = null;
    try {
      const poster = preparedPosterRef.current ?? await fetchPosterFile();
      objectUrl = URL.createObjectURL(poster);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = strategyPosterFilename(botId);
      anchor.click();
      setMessage("1200 × 630 海報已下載。");
    } catch {
      setMessage("海報暫時無法下載，請稍後再試或開啟原圖儲存。");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsBusy(false);
    }
  };

  const dialog = isOpen ? createPortal(
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) closeDialog();
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={styles.dialog}
        ref={dialogRef}
        role="dialog"
      >
        <header className={styles.dialogHeader}>
          <div>
            <p>STRATEGY SHARE STUDIO</p>
            <h2 id={titleId}>分享「{safeBotName || "Strategy"}」</h2>
            <small>海報與安全文案已自動產生，可直接分享或下載使用。</small>
          </div>
          <button aria-label="關閉分享海報" autoFocus className={styles.closeButton} onClick={closeDialog} type="button">
            <FiX aria-hidden="true" size={19} />
          </button>
        </header>

        <div className={styles.dialogBody}>
          <div className={styles.posterColumn}>
            <div className={styles.posterFrame}>
              <Image
                alt={`${safeBotName || "Strategy"} 社群分享海報預覽`}
                className={styles.posterImage}
                height={630}
                priority
                src={resolvedPosterPath}
                unoptimized
                width={1200}
              />
            </div>
            <div className={styles.posterMeta}>
              <span>PNG · 1200 × 630 · 社群連結會自動讀取此海報</span>
              <a href={resolvedPosterPath} rel="noopener noreferrer" target="_blank">
                開啟原圖 <FiExternalLink aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className={styles.shareColumn}>
            <div className={styles.captionCard}>
              <span>AUTO-GENERATED CAPTION</span>
              <p>{shareText}</p>
            </div>

            <div className={styles.primaryActions}>
              <button className={`${styles.modalButton} ${styles.modalButtonPrimary}`} disabled={isBusy} onClick={shareWithSystem} type="button">
                <FiShare2 aria-hidden="true" /> {isBusy ? "正在開啟分享…" : "系統分享（支援時附上 PNG）"}
              </button>
              <button className={styles.modalButton} disabled={isBusy} onClick={() => void downloadPoster()} type="button">
                <FiDownload aria-hidden="true" /> 下載海報
              </button>
              <button className={styles.modalButton} onClick={() => void copyCaption()} type="button">
                <FiCopy aria-hidden="true" /> 複製文案
              </button>
              <button className={styles.modalButton} onClick={() => void copyLink()} type="button">
                <FiLink aria-hidden="true" /> 複製連結
              </button>
            </div>

            <p className={styles.networkLabel}>SHARE TO SOCIAL</p>
            <div aria-label="海報分享到社群媒體" className={styles.networkGrid} role="group">
              {(Object.keys(NETWORK_LABELS) as StrategyShareNetwork[]).map((network) => (
                <button
                  className={`${styles.modalButton} ${styles.networkButton}`}
                  data-network={network}
                  key={network}
                  onClick={() => openSocialShare(network)}
                  type="button"
                >
                  {NETWORK_LABELS[network]}
                </button>
              ))}
            </div>
            <p className={styles.supportNote} data-poster-preparation={posterPreparation}>LINE、X、Facebook 與 Telegram 會帶入文案及策略網址；平台將從網址讀取這張動態海報。績效文字只會在來源為已驗證固定版本時顯示。</p>
            <p aria-live="polite" className={styles.modalFeedback}>{message}</p>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return <div className={`strategy-share-actions ${styles.root}`}>
    <div aria-label="快速分享到社群媒體" className="social-share-quick" role="group">
      {(Object.keys(NETWORK_LABELS) as StrategyShareNetwork[]).map((network) => (
        <button
          className="social-share-button"
          data-network={network}
          key={network}
          onClick={() => openSocialShare(network)}
          type="button"
        >
          {NETWORK_LABELS[network]}
        </button>
      ))}
    </div>
    <button className={`button button--secondary ${styles.shareTrigger}`} onClick={openDialog} ref={triggerRef} type="button">
      <FiImage aria-hidden="true" /> 分享海報
    </button>
    <button className="button button--ghost" onClick={() => void copyLink()} type="button"><FiLink aria-hidden="true" /> 複製連結</button>
    {message && <span className="share-feedback" role="status">{message}</span>}
    {dialog}
  </div>;
}
