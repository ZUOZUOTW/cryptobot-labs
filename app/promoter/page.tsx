"use client";

import Link from "next/link";
import { useState } from "react";
import { DEMO_PROMOTERS } from "../../data/demo-platform";
import { demoAuthPath, useDemoUser } from "../../lib/demo-auth";

export default function PromoterDashboardPage() {
  const user = useDemoUser(); const [message, setMessage] = useState(""); const promoter = DEMO_PROMOTERS[1];
  if (!user) return <div className="admin-page site-container"><section className="admin-gate glass-panel"><h1>登入後查看 KOL 分享面板</h1><Link className="button button--primary" href={demoAuthPath("/promoter")}>登入展示帳號</Link></section></div>;
  const copy = async (path: string) => { const url = `${window.location.origin}${path}`; try { await navigator.clipboard.writeText(url); setMessage("分享連結已複製"); } catch { setMessage(url); } };
  return <div className="promoter-page site-container"><header className="page-intro"><p className="eyebrow">PROMOTER DASHBOARD / DEMO</p><h1>{promoter.displayName} 分享面板</h1><p>只顯示自己的站內聚合漏斗。WEEX 返佣與推薦名單在取得正式 Partner／Broker 權限前不顯示。</p></header>
    <section className="promoter-profile glass-panel"><div><span className="risk-badge" data-risk="低">已核准</span><h2>{promoter.slug}</h2><p>VIP code：{promoter.vipCode}</p></div><p className="affiliate-inline-disclosure">分享連結可能包含推薦關係，使用者費用不因此增加。<Link href="/disclosures/affiliate">查看完整揭露</Link></p></section>
    <section className="funnel-grid" aria-label="推廣漏斗"><article><span>分享訪問</span><strong>{promoter.funnel.visits}</strong></article><article><span>網站登入</span><strong>{promoter.funnel.signups}</strong></article><article><span>OAuth 完成</span><strong>{promoter.funnel.oauth}</strong></article><article><span>Paper 啟動</span><strong>{promoter.funnel.paper}</strong></article></section>
    <section className="share-kit glass-panel"><h2>策略分享工具</h2><p>連結只帶核准的 promoter slug，不會接受任意外部網址或 WEEX code。</p><div className="button-row"><button className="button button--primary" onClick={() => void copy(`/bots/orbit-dca?via=${promoter.slug}&utm_source=social&utm_campaign=starter`)} type="button">複製含來源連結</button><button className="button button--secondary" onClick={() => void copy("/bots/orbit-dca")} type="button">複製純連結</button></div>{message && <p className="control-feedback" role="status">{message}</p>}</section>
  </div>;
}
