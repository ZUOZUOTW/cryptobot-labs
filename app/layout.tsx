import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { buildSiteMetadata, requestOrigin } from "@/lib/site-metadata";
import "./globals.css";
import "./workshop.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const productMetadata = {
  title: "CryptoBot Labs｜WEEX 自動交易策略實驗室",
  description: "探索、比較並組裝 WEEX 專屬自動交易策略，透過可重現的模擬回測安全驗證交易想法。",
} as const;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  return buildSiteMetadata(requestOrigin(requestHeaders), productMetadata);
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SiteHeader />
        <main className="site-main" id="main-content" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
