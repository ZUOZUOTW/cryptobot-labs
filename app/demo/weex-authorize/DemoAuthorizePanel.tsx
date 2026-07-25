"use client";

import Link from "next/link";
import { useState } from "react";
import { safeReturnTo, useDemoUser } from "../../../lib/demo-auth";
import { setDemoConnection } from "../../../lib/demo-connection";

export function DemoAuthorizePanel() {
  const user = useDemoUser();
  const [state, setState] = useState<"idle" | "working">("idle");
  const cancel = () => safeReturnTo(new URLSearchParams(window.location.search).get("return_to"), "/connections");
  const approve = () => {
    setState("working"); setDemoConnection("verifying");
    window.setTimeout(() => { setDemoConnection("paper-ready"); window.location.assign(`${cancel()}?status=connected`); }, 650);
  };
  return <><div className="demo-authorize-warning" role="alert"><strong>模擬授權頁，非 WEEX 官方頁</strong><span>此頁不會要求帳號密碼，也不會建立 API Key。</span></div>
    <section className="authorize-card glass-panel" aria-labelledby="authorize-title"><p className="eyebrow">WEEX OAUTH / PRODUCT DEMO</p><h1 id="authorize-title">授權 CryptoBot Labs 展示連線</h1><p>{user ? `${user.displayName}，` : ""}正式上線後，這一步會在 WEEX 官方網域完成。現在只建立一筆本機展示狀態。</p>
      <dl className="authorize-summary"><div><dt>讀取帳戶</dt><dd>允許</dd></div><div><dt>現貨／合約交易</dt><dd>依風控設定</dd></div><div><dt>提領資產</dt><dd className="value-positive">不允許</dd></div><div><dt>第一個運行</dt><dd>模擬模式</dd></div></dl>
      <div className="button-row"><button className="button button--primary" disabled={state === "working" || !user} onClick={approve} type="button">{state === "working" ? "建立展示連線中…" : "同意展示授權"}</button><Link className="button button--ghost" href="/connections">取消並返回</Link></div>
      {!user && <p className="control-feedback" role="alert">登入展示 session 已失效，請返回連線頁重新登入。</p>}
    </section></>;
}
