import { getChatGPTUser } from "../../app/chatgpt-auth";
import type { UserRecord } from "../../db/repositories";
import { normalizeUserEmail } from "../../db/repositories";
import { errorResponse } from "./http";
import { demoModeEnabled } from "./demo-mode";
import { getCurrentSupabaseUser } from "./supabase-auth";
import { canonicalDisplayName } from "../display-name";

export interface PlatformIdentity { email: string; displayName: string; subject?: string }
export interface PlatformIdentityProvider { getIdentity(): Promise<PlatformIdentity | null> }
export interface ApiUserRepository {
  upsertIdentity(input: { id: string; email: string; displayName: string; now: number }): Promise<UserRecord>;
}
export interface ApiAuthDependencies {
  identityProvider: PlatformIdentityProvider;
  userRepository: ApiUserRepository;
  deriveUserId(email: string): Promise<string>;
  now(): number;
}

export const workspaceIdentityProvider: PlatformIdentityProvider = {
  async getIdentity() {
    const user = await getChatGPTUser();
    return user ? { email: user.email, displayName: user.displayName } : null;
  },
};

export const supabaseIdentityProvider: PlatformIdentityProvider = {
  async getIdentity() {
    const user = await getCurrentSupabaseUser();
    return user ? { subject: user.id, email: user.email, displayName: user.displayName } : null;
  },
};

export const platformIdentityProvider: PlatformIdentityProvider = {
  getIdentity: () => demoModeEnabled() ? workspaceIdentityProvider.getIdentity() : supabaseIdentityProvider.getIdentity(),
};

export async function deriveWorkspaceUserId(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return `usr_${btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function requireApiUser(_request: Request, dependencies: ApiAuthDependencies): Promise<
  { ok: true; user: UserRecord } | { ok: false; response: Response }
> {
  let identity: PlatformIdentity | null;
  try { identity = await dependencies.identityProvider.getIdentity(); } catch {
    return { ok: false, response: errorResponse(null, { status: 401, code: "unauthorized" }) };
  }
  if (!identity) return { ok: false, response: errorResponse(null, { status: 401, code: "unauthorized" }) };
  let email: string; let name: string; let userId: string;
  try {
    email = normalizeUserEmail(identity.email);
    name = canonicalDisplayName(identity.displayName)
      ?? canonicalDisplayName(email.split("@")[0])
      ?? "會員";
    userId = identity.subject ?? await dependencies.deriveUserId(email);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(userId)) throw new Error("derived user id is invalid");
  } catch {
    return { ok: false, response: errorResponse(null, { status: 401, code: "identity_invalid" }) };
  }
  try {
    const user = await dependencies.userRepository.upsertIdentity({ id: userId, email, displayName: name, now: dependencies.now() });
    return { ok: true, user };
  } catch {
    return { ok: false, response: errorResponse(null, { status: 409, code: "identity_conflict" }) };
  }
}
