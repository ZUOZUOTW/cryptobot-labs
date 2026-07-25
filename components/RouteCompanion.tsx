"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

type CompanionTheme = {
  image: string;
  label: string;
  detail: string;
  mode: string;
  alt?: string;
  signals?: [string, string];
};

const resolveTheme = (pathname: string): CompanionTheme | null => {
  if (pathname === "/") return null;
  if (pathname.startsWith("/auth")) return null;
  if (pathname.startsWith("/workshop")) return {
    image: "/mascots/ai-workshop-engineer-v3.webp",
    label: "模組裝配中",
    detail: "STRATEGY ASSEMBLY",
    mode: "builder",
    alt: "CryptoBot 策略工程師正在串接訊號、邏輯與風控模組",
    signals: ["SIG", "RISK"],
  };
  if (pathname.startsWith("/leaderboard")) return { image: "/mascots/ai-observer.webp", label: "排名分析中", detail: "RISK-ADJUSTED AI", mode: "ranking" };
  if (pathname.startsWith("/connections")) return { image: "/mascots/ai-guardian.webp", label: "連線守護中", detail: "OAUTH SAFETY CHECK", mode: "connection" };
  if (pathname === "/runs" || pathname === "/runs/preview") return null;
  if (pathname.startsWith("/runs")) return { image: "/mascots/ai-guardian.webp", label: "風險監測中", detail: "CLOUD RUN WATCH", mode: "run" };
  if (pathname.startsWith("/activity")) return { image: "/mascots/ai-observer.webp", label: "軌跡核對中", detail: "AUDIT SIGNAL TRACE", mode: "activity" };
  if (pathname.startsWith("/backtests")) return { image: "/mascots/ai-observer.webp", label: "回測掃描中", detail: "EVIDENCE ANALYSIS", mode: "backtest" };
  return { image: "/mascots/ai-observer.webp", label: "市場觀測中", detail: "BTC · AI SIGNAL", mode: "market" };
};

export function RouteCompanion() {
  const pathname = usePathname();
  const theme = resolveTheme(pathname);

  if (!theme) return null;

  const [primarySignal, secondarySignal] = theme.signals ?? ["BTC", "AI"];

  return (
    <aside className={`route-companion route-companion--${theme.mode}`} aria-label={`${theme.label}的 AI 機器人動畫`}>
      <div className="route-companion__halo" aria-hidden="true" />
      <div className="route-companion__signal route-companion__signal--one" aria-hidden="true">{primarySignal}</div>
      <div className="route-companion__signal route-companion__signal--two" aria-hidden="true">{secondarySignal}</div>
      {theme.mode === "builder" && (
        <div className="route-companion__workshop-readout" aria-hidden="true">
          <span>01 SIGNAL</span><span>02 MODEL</span><span>03 RISK</span>
        </div>
      )}
      <Image alt={theme.alt ?? "親切可愛的 CryptoBot AI 導航機器人"} className="route-companion__image" height={420} src={theme.image} width={420} />
      <div className="route-companion__status">
        <span aria-hidden="true" />
        <div><strong>{theme.label}</strong><small>{theme.detail}</small></div>
      </div>
    </aside>
  );
}
