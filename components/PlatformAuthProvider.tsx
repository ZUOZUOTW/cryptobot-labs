"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  const [user, setUser] = useState(initialUser);
  useEffect(() => {
    if (mode !== "production" || initialUser) return;
    const controller = new AbortController();
    void fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { user?: unknown };
      const candidate = body.user;
      if (!candidate || typeof candidate !== "object") return;
      const value = candidate as Record<string, unknown>;
      if (typeof value.id === "string" && typeof value.email === "string"
        && typeof value.displayName === "string") {
        setUser({ id: value.id, email: value.email, displayName: value.displayName });
      }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [initialUser, mode]);
  return <PlatformAuthContext.Provider value={{ mode, user }}>{children}</PlatformAuthContext.Provider>;
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
