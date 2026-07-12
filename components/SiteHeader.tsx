"use client";

import Link from "next/link";
import { useState } from "react";

const NAVIGATION_LINKS = [
  { href: "/bots", label: "機器人" },
  { href: "/leaderboard", label: "排行榜" },
  { href: "/workshop", label: "組裝車間" },
  { href: "/backtests", label: "歷史回測" },
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
          <span className="exchange-badge">
            <span className="exchange-badge__signal" aria-hidden="true" />
            WEEX ONLY
          </span>
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
      </nav>
    </header>
  );
}
