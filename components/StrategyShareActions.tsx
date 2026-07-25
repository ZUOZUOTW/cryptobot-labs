"use client";

import { useState } from "react";

export function StrategyShareActions({ botId, botName, sharePath, via }: {
  botId: string;
  botName: string;
  sharePath?: string;
  via?: string;
}) {
  const [message, setMessage] = useState("");
  const shareUrl = () => {
    const url = new URL(sharePath ?? `/bots/${encodeURIComponent(botId)}`, window.location.origin);
    if (via) url.searchParams.set("via", via);
    return url.toString();
  };
  const copy = async () => {
    const url = shareUrl();
    try { await navigator.clipboard.writeText(url); setMessage("分享連結已複製"); }
    catch { setMessage(url); }
  };
  const share = async () => {
    const url = shareUrl();
    if (navigator.share) {
      try { await navigator.share({ title: `${botName}｜CryptoBot Labs`, text: `查看 ${botName} 的策略規則、風險與模擬證據。`, url }); return; }
      catch { /* The native share sheet may be cancelled. */ }
    }
    await copy();
  };
  const openSocialShare = (network: "line" | "x" | "facebook" | "telegram") => {
    const url = shareUrl();
    const text = `查看 ${botName} 的策略規則、風險與模擬證據。`;
    const targets = {
      line: `https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`,
      x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    };
    window.open(targets[network], "_blank", "noopener,noreferrer");
  };
  return <div className="strategy-share-actions">
    <div aria-label="快速分享到社群媒體" className="social-share-quick" role="group">
      <button className="social-share-button" data-network="line" onClick={() => openSocialShare("line")} type="button">LINE</button>
      <button className="social-share-button" data-network="x" onClick={() => openSocialShare("x")} type="button">X</button>
      <button className="social-share-button" data-network="facebook" onClick={() => openSocialShare("facebook")} type="button">Facebook</button>
      <button className="social-share-button" data-network="telegram" onClick={() => openSocialShare("telegram")} type="button">Telegram</button>
    </div>
    <button className="button button--secondary" onClick={() => void share()} type="button">更多分享</button>
    <button className="button button--ghost" onClick={() => void copy()} type="button">複製連結</button>
    {message && <span className="share-feedback" role="status">{message}</span>}
  </div>;
}
