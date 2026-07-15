export type DemoRole = "user" | "creator" | "kol" | "bd" | "admin";

export interface DemoPromoter {
  slug: string;
  displayName: string;
  role: "kol" | "bd";
  vipCode: string;
  inviteUrl: string;
  status: "active" | "pending";
  disclosureAcceptedAt: string;
  funnel: { visits: number; signups: number; oauth: number; paper: number };
}

export const DEFAULT_PROMOTER_SLUG = "cryptobot-labs";

export const DEMO_PROMOTERS: DemoPromoter[] = [
  {
    slug: DEFAULT_PROMOTER_SLUG,
    displayName: "CryptoBot Labs",
    role: "bd",
    vipCode: "LABS-DEMO",
    inviteUrl: "https://www.weex.com/",
    status: "active",
    disclosureAcceptedAt: "2026-07-14T01:10:00.000Z",
    funnel: { visits: 1248, signups: 186, oauth: 94, paper: 78 },
  },
  {
    slug: "orbit-trader",
    displayName: "Orbit Trader",
    role: "kol",
    vipCode: "ORBIT-DEMO",
    inviteUrl: "https://www.weex.com/",
    status: "active",
    disclosureAcceptedAt: "2026-07-14T02:20:00.000Z",
    funnel: { visits: 842, signups: 121, oauth: 63, paper: 52 },
  },
  {
    slug: "pending-partner",
    displayName: "Pending Partner",
    role: "kol",
    vipCode: "PENDING",
    inviteUrl: "https://www.weex.com/",
    status: "pending",
    disclosureAcceptedAt: "2026-07-14T03:30:00.000Z",
    funnel: { visits: 0, signups: 0, oauth: 0, paper: 0 },
  },
];

export const DEMO_USERS = [
  { id: "demo-user-001", createdAt: "2026-07-14", displayName: "林小宇", email: "lin@example.test", provider: "Google", role: "user" as DemoRole, status: "正常", source: "orbit-trader", promoter: "Orbit Trader", weex: "已連接", paper: "已通過", live: "未啟用", lastActive: "2 分鐘前", flag: "—" },
  { id: "demo-user-002", createdAt: "2026-07-14", displayName: "Kai Chen", email: "kai@example.test", provider: "Email", role: "creator" as DemoRole, status: "正常", source: "首頁", promoter: "CryptoBot Labs", weex: "待授權", paper: "運行中", live: "未啟用", lastActive: "18 分鐘前", flag: "—" },
  { id: "demo-user-003", createdAt: "2026-07-13", displayName: "Orbit Trader", email: "orbit@example.test", provider: "Google", role: "kol" as DemoRole, status: "正常", source: "直接", promoter: "Orbit Trader", weex: "已連接", paper: "已通過", live: "未啟用", lastActive: "1 小時前", flag: "返佣待 WEEX 確認" },
  { id: "demo-user-004", createdAt: "2026-07-12", displayName: "測試管理員", email: "admin@example.test", provider: "Email", role: "admin" as DemoRole, status: "正常", source: "內部", promoter: "—", weex: "未連接", paper: "未開始", live: "未啟用", lastActive: "昨天", flag: "—" },
] as const;

export function activePromoter(slug: string | null | undefined): DemoPromoter | null {
  if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) return null;
  return DEMO_PROMOTERS.find((promoter) => promoter.slug === slug && promoter.status === "active") ?? null;
}
