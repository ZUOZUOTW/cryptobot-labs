"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiActivity, FiClock, FiCompass, FiTool, FiUser } from "react-icons/fi";
import { useI18n } from "./I18nProvider";
import { usePlatformAuth } from "./PlatformAuthProvider";

const PRIMARY_TABS = [
  { href: "/bots", label: "探索策略", icon: FiCompass },
  { href: "/workshop", label: "組裝策略", icon: FiTool },
  { href: "/runs", label: "我的運行", icon: FiActivity },
  { href: "/activity", label: "最後活動", icon: FiClock },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const { user } = usePlatformAuth();
  const { t } = useI18n();

  if (pathname === "/workshop") return null;

  const accountHref = user ? "/connections" : `/auth?return_to=${encodeURIComponent(pathname || "/")}`;
  const tabs = [...PRIMARY_TABS, { href: accountHref, label: user ? "交易連線" : "登入", icon: FiUser }];

  return (
    <nav className="mobile-tab-bar" aria-label={t("行動版導覽")}>
      {tabs.map(({ href, label, icon: Icon }) => {
        const route = href.split("?")[0];
        const current = route === "/bots"
          ? pathname === route || pathname.startsWith(`${route}/`)
          : pathname === route || (route !== "/" && pathname.startsWith(`${route}/`));
        return (
          <Link aria-current={current ? "page" : undefined} href={href} key={label}>
            <Icon aria-hidden="true" />
            <span>{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
