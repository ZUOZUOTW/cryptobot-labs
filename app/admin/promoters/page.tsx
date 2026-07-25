"use client";

import Link from "next/link";
import { useState } from "react";
import { DemoAdminGate } from "../../../components/admin/DemoAdminGate";
import { DEMO_PROMOTERS } from "../../../data/demo-platform";

export default function AdminPromotersPage() {
  const [message, setMessage] = useState("");
  return <div className="admin-page site-container"><DemoAdminGate>
    <header className="page-intro"><p className="eyebrow">ADMIN / SHARING / DEMO</p><h1>研究分享來源管理</h1><p>只管理站內研究內容的分享來源與匿名聚合使用狀態。</p><div className="button-row"><Link className="button button--secondary" href="/admin/users">返回會員</Link><Link className="button button--ghost" href="/promoter">查看分享體驗</Link></div></header>
    {message && <p className="control-feedback" role="status">{message}</p>}
    <div className="promoter-admin-grid">{DEMO_PROMOTERS.map((promoter) => <article className="glass-panel promoter-admin-card" key={promoter.slug}><div><span className="risk-badge" data-risk={promoter.status === "active" ? "低" : "中"}>{promoter.status}</span><p className="eyebrow">{promoter.role.toUpperCase()} / {promoter.slug}</p><h2>{promoter.displayName}</h2></div><dl><div><dt>VIP code</dt><dd>{promoter.vipCode}</dd></div><div><dt>邀請網址</dt><dd>weex.com（已遮罩）</dd></div><div><dt>訪問</dt><dd>{promoter.funnel.visits}</dd></div><div><dt>OAuth</dt><dd>{promoter.funnel.oauth}</dd></div><div><dt>模擬啟動</dt><dd>{promoter.funnel.paper}</dd></div></dl><button className="button button--secondary button--small" onClick={() => setMessage(`${promoter.displayName}：${promoter.status === "active" ? "展示停用並要求重新核准" : "展示核准完成"}。`)} type="button">{promoter.status === "active" ? "停用推廣者" : "核准展示資料"}</button></article>)}</div>
  </DemoAdminGate></div>;
}
