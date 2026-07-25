"use client";

import { createContext, useContext, type ReactNode } from "react";
import { signOutDemo, useDemoUser } from "../lib/demo-auth";
import type { PlatformUser } from "../lib/server/supabase-auth";

type AuthMode = "demo" | "production";
interface PlatformAuthValue { mode: AuthMode; user: PlatformUser | null }

const PlatformAuthContext = createContext<PlatformAuthValue | null>(null);

export function PlatformAuthProvider({ mode, initialUser, children }: {
  mode: AuthMode;
  initialUser: PlatformUser | null;
  children: ReactNode;
}) {
  return <PlatformAuthContext.Provider value={{ mode, user: initialUser }}>{children}</PlatformAuthContext.Provider>;
}

export function usePlatformAuth(): PlatformAuthValue {
  const context = useContext(PlatformAuthContext);
  const demoUser = useDemoUser();
  if (!context) return { mode: "demo", user: demoUser ? { ...demoUser, id: `demo:${demoUser.email}` } : null };
  if (context.mode === "demo") return { mode: "demo", user: demoUser ? { ...demoUser, id: `demo:${demoUser.email}` } : null };
  return context;
}

export function usePlatformUser(): PlatformUser | null {
  return usePlatformAuth().user;
}

export async function signOutPlatform(mode: AuthMode): Promise<void> {
  if (mode === "demo") {
    signOutDemo();
    window.location.assign("/");
    return;
  }
  await fetch("/auth/signout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  window.location.assign("/");
}
