"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { demoAuthPath, useDemoUser } from "../../lib/demo-auth";

export function DemoAdminGate({ children }: { children: ReactNode }) {
  const user = useDemoUser();
  if (!user) return <section className="admin-gate glass-panel"><p className="eyebrow">DEMO ADMIN</p><h1>登入後查看展示後台</h1><p>正式版將由受保護的角色資料與伺服器端授權控制；不使用可由會員修改的 metadata。</p><Link className="button button--primary" href={demoAuthPath("/admin/users")}>登入展示帳號</Link></section>;
  return <>{children}</>;
}
