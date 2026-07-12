"use client";

import { usePathname } from "next/navigation";

type CompanionTheme = {
  image: string;
  label: string;
  detail: string;
  mode: string;
};

const resolveTheme = (pathname: string): CompanionTheme | null => {
  if (pathname === "/") return null;
  if (pathname.startsWith("/workshop")) return { image: "/mascots/ai-builder.png", label: "策略組裝中", detail: "AI LOGIC BUILDER", mode: "builder" };
  if (pathname.startsWith("/leaderboard")) return { image: "/mascots/ai-guardian.png", label: "排名分析中", detail: "RISK-ADJUSTED AI", mode: "ranking" };
  if (pathname.startsWith("/connections")) return { image: "/mascots/ai-guardian.png", label: "連線守護中", detail: "LOCAL-FIRST SHIELD", mode: "connection" };
  if (pathname.startsWith("/runs")) return { image: "/mascots/ai-guardian.png", label: "風險監測中", detail: "LIVE SAFETY WATCH", mode: "run" };
  if (pathname.startsWith("/activity")) return { image: "/mascots/ai-observer.png", label: "軌跡核對中", detail: "AUDIT SIGNAL TRACE", mode: "activity" };
  if (pathname.startsWith("/backtests")) return { image: "/mascots/ai-observer.png", label: "回測掃描中", detail: "EVIDENCE ANALYSIS", mode: "backtest" };
  return { image: "/mascots/ai-observer.png", label: "市場觀測中", detail: "BTC · AI SIGNAL", mode: "market" };
};

export function RouteCompanion() {
  const pathname = usePathname();
  const theme = resolveTheme(pathname);

  if (!theme) return null;

  return (
    <aside className={`route-companion route-companion--${theme.mode}`} aria-label={`${theme.label}的 AI 機器人動畫`}>
      <div className="route-companion__halo" aria-hidden="true" />
      <div className="route-companion__signal route-companion__signal--one" aria-hidden="true">BTC</div>
      <div className="route-companion__signal route-companion__signal--two" aria-hidden="true">AI</div>
      <img alt="親切可愛的 CryptoBot AI 導航機器人" className="route-companion__image" height="360" src={theme.image} width="420" />
      <div className="route-companion__status">
        <span aria-hidden="true" />
        <div><strong>{theme.label}</strong><small>{theme.detail}</small></div>
      </div>
    </aside>
  );
}
