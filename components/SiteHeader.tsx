"use client";

import Link from "next/link";
import { useState } from "react";
import { signOutPlatform, usePlatformAuth } from "./PlatformAuthProvider";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PwaInstallButton } from "./PwaInstallButton";

const NAVIGATION_LINKS = [
  { href: "/bots", label: "探索策略" },
  { href: "/workshop", label: "組裝策略" },
  { href: "/leaderboard", label: "排行榜" },
  { href: "/runs", label: "我的運行" },
] as const;

function NavigationLinks() {
  return NAVIGATION_LINKS.map(({ href, label }) => (
    <Link className="site-nav__link" href={href} key={href}>
      {label}
    </Link>
  ));
}

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { mode, user } = usePlatformAuth();

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      <div className="site-container site-header__inner">
        <Link className="brand" href="/" aria-label="CryptoBot Labs 首頁">
          <span className="brand__orbit" aria-hidden="true">
            <span className="brand__core" />
          </span>
          <span className="brand__wordmark">
            <strong>CryptoBot</strong>
            <span>Labs</span>
          </span>
        </Link>

        <nav className="site-nav site-nav--desktop" aria-label="主要導覽">
          <NavigationLinks />
        </nav>

        <div className="site-header__actions">
          <LanguageSwitcher />
          {user ? <details className="user-menu"><summary>{user.displayName}</summary><div><Link href="/connections">交易連線</Link>{mode === "demo" && <Link href="/admin/users">展示後台</Link>}<button onClick={() => { void signOutPlatform(mode); }} type="button">登出</button></div></details>
            : <Link className="button button--primary button--small header-login" href="/auth?return_to=%2F">登入</Link>}
          <button
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "關閉導覽選單" : "開啟導覽選單"}
            className="menu-button"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </div>

      <nav
        aria-label="行動版導覽"
        className="site-nav site-nav--mobile"
        hidden={!menuOpen}
        id="mobile-navigation"
      >
        <NavigationLinks />
        {user ? <Link className="site-nav__link" href="/connections">交易連線</Link> : <Link className="site-nav__link" href="/auth?return_to=%2F">登入</Link>}
        <PwaInstallButton />
      </nav>
    </header>
  );
}
