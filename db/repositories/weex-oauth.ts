import type { ControlPlaneDatabase } from "../index";
import type { WeexCredentialSource } from "@cryptobot-labs/weex-client";
import { id } from "./shared";

export type WeexOAuthConnectionStatus = "pending" | "processing" | "active" | "reauthorization_required" | "revoked" | "error";
export type { WeexCredentialSource } from "@cryptobot-labs/weex-client";
export interface SafeWeexOAuthConnection {
  id: string;
  status: WeexOAuthConnectionStatus;
  credentialSource: WeexCredentialSource;
  maskedApiKeySuffix: string | null;
  permissions: { read: boolean; spotTrade: boolean; futuresTrade: boolean; withdrawal: false };
  withdrawalAccessAbsent: boolean;
  verifiedAt: number | null;
  revokedAt: number | null;
  updatedAt: number;
}

interface Row {
  id: string;
  status: string;
  credentialSource: string;
  maskedApiKeySuffix: string | null;
  permissionsJson: string | Record<string, unknown>;
  withdrawalAccessAbsent: boolean | number;
  verifiedAt: number | null;
  revokedAt: number | null;
  updatedAt: number;
}

const STATUSES = new Set<WeexOAuthConnectionStatus>([
  "pending", "processing", "active", "reauthorization_required", "revoked", "error",
]);

const parse = (row: Row): SafeWeexOAuthConnection => {
  if (!STATUSES.has(row.status as WeexOAuthConnectionStatus)) throw new Error("stored WEEX connection status is invalid");
  if (row.credentialSource !== "manual" && row.credentialSource !== "oauth") {
    throw new Error("stored WEEX credential source is invalid");
  }
  const permissions = typeof row.permissionsJson === "string" ? JSON.parse(row.permissionsJson) as unknown : row.permissionsJson;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) throw new Error("stored permissions are invalid");
  const value = permissions as Record<string, unknown>;
  const safePermissions = { read: value.read === true, spotTrade: value.spotTrade === true,
    futuresTrade: value.futuresTrade === true, withdrawal: false as const };
  return { id: row.id, status: row.status as WeexOAuthConnectionStatus,
    credentialSource: row.credentialSource, maskedApiKeySuffix: row.maskedApiKeySuffix,
    permissions: safePermissions, withdrawalAccessAbsent: Boolean(row.withdrawalAccessAbsent),
    verifiedAt: row.verifiedAt, revokedAt: row.revokedAt, updatedAt: row.updatedAt };
};

export function createWeexOAuthConnectionRepository(database: ControlPlaneDatabase) {
  return {
    async latestForUser(userId: string): Promise<SafeWeexOAuthConnection | null> {
      const row = await database.prepare(`select id,status,credential_source as credentialSource,
        masked_api_key_suffix as maskedApiKeySuffix,
        permissions_json as permissionsJson,withdrawal_access_absent as withdrawalAccessAbsent,
        verified_at as verifiedAt,revoked_at as revokedAt,updated_at as updatedAt
        from weex_connections where user_id=? and provider='weex' order by updated_at desc,id desc limit 1`)
        .bind(id(userId, "userId")).first<Row>();
      return row ? parse(row) : null;
    },
  };
}
