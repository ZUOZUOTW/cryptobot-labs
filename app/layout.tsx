import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { RouteCompanion } from "@/components/RouteCompanion";
import { DemoModeBanner } from "@/components/DemoModeBanner";
import { PlatformAuthProvider } from "@/components/PlatformAuthProvider";
import { demoModeEnabled } from "@/lib/server/demo-mode";
import { getCurrentSupabaseUser } from "@/lib/server/supabase-auth";
import {
  buildSiteMetadata,
  requestOrigin,
  SITE_DESCRIPTION,
  SITE_TITLE,
} from "@/lib/site-metadata";
import "./globals.css";
import "./workshop.css";
import "./observatory-polish.css";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demoMode = demoModeEnabled();
  const initialUser = demoMode ? null : await getCurrentSupabaseUser();
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PlatformAuthProvider mode={demoMode ? "demo" : "production"} initialUser={initialUser}>
          <DemoModeBanner />
          <SiteHeader />
          <main className="site-main" id="main-content" tabIndex={-1}>
            <RouteCompanion />
            {children}
          </main>
          <SiteFooter />
        </PlatformAuthProvider>
      </body>
    </html>
  );
}
