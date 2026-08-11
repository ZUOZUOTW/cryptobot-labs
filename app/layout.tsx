import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { RouteCompanion } from "@/components/RouteCompanion";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { PlatformAuthProvider } from "@/components/PlatformAuthProvider";
import { I18nProvider } from "@/components/I18nProvider";
import { MobileTabBar } from "@/components/MobileTabBar";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import { demoModeEnabled } from "@/lib/server/demo-mode";
import { DEFAULT_LOCALE, localeDirection } from "@/lib/i18n/locales";
import {
  buildSiteMetadata,
  configuredSiteOrigin,
  SITE_DESCRIPTION,
  SITE_TITLE,
} from "@/lib/site-metadata";
import "./globals.css";
import "./observatory-polish.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const metadataOrigin = configuredSiteOrigin(
  process.env.PUBLIC_ORIGIN ?? "https://www.cryptobotlabs.app",
);

export const metadata: Metadata = buildSiteMetadata(metadataOrigin, {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demoMode = demoModeEnabled();
  const initialLocale = DEFAULT_LOCALE;
  return (
    <html dir={localeDirection(initialLocale)} lang={initialLocale} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#06070b" />
        <script
          dangerouslySetInnerHTML={{ __html: `(function(){try{var supported=["zh-Hant","zh-Hans","en","ru","ja"];var cookie=document.cookie.split(";").map(function(part){return part.trim().split("=")}).find(function(pair){return pair[0]==="cryptobot-locale"});var saved=localStorage.getItem("cryptobot-labs.locale")||(cookie?decodeURIComponent(cookie[1]):null);var tags=(navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language]).map(function(value){return String(value||"").toLowerCase().replaceAll("_","-")});var locale=supported.includes(saved)?saved:null;if(!locale){for(var i=0;i<tags.length;i++){var tag=tags[i];if(tag==="zh-hant"||tag.indexOf("zh-hant-")===0||tag.indexOf("zh-tw")===0||tag.indexOf("zh-hk")===0||tag.indexOf("zh-mo")===0){locale="zh-Hant";break}if(tag==="zh-hans"||tag.indexOf("zh-hans-")===0||tag==="zh"||tag.indexOf("zh-cn")===0||tag.indexOf("zh-sg")===0){locale="zh-Hans";break}if(tag==="en"||tag.indexOf("en-")===0){locale="en";break}if(tag==="ru"||tag.indexOf("ru-")===0){locale="ru";break}if(tag==="ja"||tag.indexOf("ja-")===0){locale="ja";break}}}locale=locale||"zh-Hant";document.documentElement.lang=locale;document.documentElement.dir="ltr";document.documentElement.dataset.locale=locale}catch(e){}})();` }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider initialLocale={initialLocale}>
          <PlatformAuthProvider mode={demoMode ? "demo" : "production"} initialUser={null}>
            <DemoModeBanner />
            <SiteHeader />
            <main className="site-main" id="main-content" tabIndex={-1}>
              <RouteCompanion />
              {children}
            </main>
            <SiteFooter />
            <MobileTabBar />
            <PwaRegistrar />
          </PlatformAuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
