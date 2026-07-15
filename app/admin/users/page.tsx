"use client";

import Link from "next/link";
import { useState } from "react";
import { DemoAdminGate } from "../../../components/admin/DemoAdminGate";
import { DEMO_USERS } from "../../../data/demo-platform";

export default function AdminUsersPage() {
  const [message, setMessage] = useState("");
  return <div className="admin-page site-container"><DemoAdminGate>
    <header className="page-intro"><p className="eyebrow">ADMIN / USERS / DEMO</p><h1>會員與運行狀態</h1><p>只載入產品狀態與安全投影，不載入交易明細，也不會顯示任何完整 API Key、Secret 或 Passphrase。</p>
      <div className="button-row"><Link className="button button--secondary" href="/admin/promoters">管理推廣者</Link><Link className="button button--ghost" href="/promoter">KOL 分享面板</Link><button className="button button--ghost" onClick={() => setMessage("已產生不含交易憑證的展示 CSV。") } type="button">匯出安全 CSV</button></div></header>
    {message && <p className="control-feedback" role="status">{message}</p>}
    <div className="table-shell glass-panel admin-table"><table><caption>展示會員清單</caption><thead><tr><th>建立日期</th><th>會員</th><th>登入／角色</th><th>來源</th><th>WEEX</th><th>Paper／Live</th><th>最後活動</th><th>旗標／動作</th></tr></thead><tbody>{DEMO_USERS.map((user) => <tr key={user.id}><td>{user.createdAt}</td><td><strong>{user.displayName}</strong><small>{user.email}</small></td><td>{user.provider}<small>{user.role}</small></td><td>{user.source}<small>{user.promoter}</small></td><td>{user.weex}</td><td>{user.paper}<small>Live：{user.live}</small></td><td>{user.lastActive}</td><td>{user.flag}<button className="text-button" onClick={() => setMessage(`展示動作：已要求 ${user.displayName} 停止新訂單。`)} type="button">停權／停止</button></td></tr>)}</tbody></table></div>
  </DemoAdminGate></div>;
}
