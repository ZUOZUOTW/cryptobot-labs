"use client";

import Link from "next/link";
import { useI18n } from "../I18nProvider";
import { demoAuthPath, useDemoUser } from "../../lib/demo-auth";
import { useDemoStrategies } from "../../lib/demo-strategies";

export function DemoBacktestHistory() {
  const { locale } = useI18n();
  const user = useDemoUser();
  const strategies = useDemoStrategies();

  if (!user) return <section className="historical-empty glass-panel"><h2>登入後查看保存紀錄</h2><p>展示帳號會保留本機瀏覽器中的策略與回測摘要，不會建立真實交易所連線。</p><Link className="button button--primary" href={demoAuthPath("/backtests")}>Google／Email 登入</Link></section>;
  if (strategies.length === 0) return <section className="historical-empty glass-panel"><h2>還沒有保存的回測</h2><p>到組裝車間完成快速回測，再按「保存策略」建立第一筆紀錄。</p><Link className="button button--primary" href="/workshop">開始第一次回測</Link></section>;

  return <section className="demo-history-grid" aria-label="已保存回測紀錄">{strategies.map((strategy) => <article className="glass-panel" key={strategy.id}>
    <span className="risk-badge" data-risk="低">模擬</span><h2>{strategy.config.name}</h2>
    <p>{strategy.config.symbol} · {strategy.report ? "已有回測證據" : "等待回測"}</p>
    <small>保存於 {new Date(strategy.savedAt).toLocaleString(locale)}</small>
    <Link className="button button--secondary" href={`/workshop?bot=${encodeURIComponent(strategy.config.id)}`}>開啟策略</Link>
  </article>)}</section>;
}
