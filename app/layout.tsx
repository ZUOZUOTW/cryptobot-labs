import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  buildSiteMetadata,
  requestOrigin,
  SITE_DESCRIPTION,
  SITE_TITLE,
} from "@/lib/site-metadata";
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
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
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
