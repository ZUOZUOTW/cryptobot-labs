import type { ControlPlaneDatabase } from "../index";
import { changed, displayName, exactInput, expiry, hash, id, limit, nonce, publicKeyJwkJson, time } from "./shared";

export type DevicePlatform = "windows" | "macos";
export interface DeviceRecord {
  id: string; userId: string; name: string; platform: DevicePlatform; publicKeyJwk: string;
  status: "active" | "revoked"; pairedAt: number; lastSeenAt: number | null; revokedAt: number | null;
  createdAt: number; updatedAt: number;
}
export interface PairingCodeRecord { id: string; userId: string; codeHash: string; expiresAt: number; consumedAt: number | null; createdAt: number }
export interface DeviceCredentialRecord { deviceId: string; userId: string; credentialHash: string; expiresAt: number; revokedAt: number | null; createdAt: number }

const deviceColumns = `id, user_id AS userId, name, platform, public_key_jwk AS publicKeyJwk,
  status, paired_at AS pairedAt, last_seen_at AS lastSeenAt, revoked_at AS revokedAt,
  created_at AS createdAt, updated_at AS updatedAt`;
const pairingColumns = `id, user_id AS userId, code_hash AS codeHash, expires_at AS expiresAt,
  consumed_at AS consumedAt, created_at AS createdAt`;
const credentialColumns = `device_id AS deviceId, user_id AS userId, credential_hash AS credentialHash,
  expires_at AS expiresAt, revoked_at AS revokedAt, created_at AS createdAt`;

const platform = (value: string): DevicePlatform => {
  if (value !== "windows" && value !== "macos") throw new Error("platform must be windows or macos");
  return value;
};

export function createDeviceRepository(database: ControlPlaneDatabase) {
  const get = (userId: string, deviceId: string): Promise<DeviceRecord | null> => database.prepare(`
    SELECT ${deviceColumns} FROM devices WHERE user_id = ? AND id = ?
  `).bind(id(userId, "userId"), id(deviceId, "deviceId")).first<DeviceRecord>();

  return {
    async create(input: { id: string; userId: string; name: string; platform: string; publicKeyJwk: unknown; now: number }): Promise<DeviceRecord> {
      exactInput(input, ["id", "userId", "name", "platform", "publicKeyJwk", "now"]);
      const now = time(input.now, "now");
      const row = await database.prepare(`
        INSERT INTO devices (id, user_id, name, platform, public_key_jwk, status, paired_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
        RETURNING ${deviceColumns}
      `).bind(id(input.id, "deviceId"), id(input.userId, "userId"), displayName(input.name, "device name"),
        platform(input.platform), publicKeyJwkJson(input.publicKeyJwk), now, now, now).first<DeviceRecord>();
      if (!row) throw new Error("device creation failed");
      return row;
    },
    get,
    async list(userId: string, options: { limit: number; cursor?: string } ): Promise<{ items: DeviceRecord[]; nextCursor: string | null }> {
      const owner = id(userId, "userId");
      const pageSize = limit(options.limit);
      const cursor = options.cursor === undefined ? null : id(options.cursor, "cursor");
      const result = await database.prepare(`
        SELECT ${deviceColumns} FROM devices
        WHERE user_id = ? AND (? IS NULL OR id > ?)
        ORDER BY id ASC LIMIT ?
      `).bind(owner, cursor, cursor, pageSize + 1).all<DeviceRecord>();
      if (!result.success) throw new Error("device list failed");
      const more = result.results.length > pageSize;
      const items = result.results.slice(0, pageSize);
      return { items, nextCursor: more ? items.at(-1)!.id : null };
    },
    async touch(userId: string, deviceId: string, nowValue: number): Promise<DeviceRecord | null> {
      return database.prepare(`
        UPDATE devices SET last_seen_at = ?, updated_at = ?
        WHERE user_id = ? AND id = ? AND status = 'active' RETURNING ${deviceColumns}
      `).bind(time(nowValue, "now"), nowValue, id(userId, "userId"), id(deviceId, "deviceId"))
        .first<DeviceRecord>();
    },
    async revoke(userId: string, deviceId: string, nowValue: number): Promise<DeviceRecord | null> {
      const owner = id(userId, "userId");
      const target = id(deviceId, "deviceId");
      const now = time(nowValue, "now");
      await database.batch([
        database.prepare(`UPDATE devices SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), updated_at = ? WHERE id = ? AND user_id = ?`)
          .bind(now, now, target, owner),
        database.prepare(`UPDATE device_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ? AND user_id = ?`)
          .bind(now, target, owner),
      ]);
      return get(owner, target);
    },
  };
}

export function createPairingCodeRepository(database: ControlPlaneDatabase) {
  return {
    async issue(input: { id: string; userId: string; codeHash: string; now: number; expiresAt: number }): Promise<PairingCodeRecord> {
      exactInput(input, ["id", "userId", "codeHash", "now", "expiresAt"]);
      const now = time(input.now, "now");
      const row = await database.prepare(`
        INSERT INTO pairing_codes (id, user_id, code_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?) RETURNING ${pairingColumns}
      `).bind(id(input.id, "pairingCodeId"), id(input.userId, "userId"), hash(input.codeHash),
        expiry(input.expiresAt, now), now).first<PairingCodeRecord>();
      if (!row) throw new Error("pairing code issue failed");
      return row;
    },
    consume(codeHash: string, nowValue: number): Promise<PairingCodeRecord | null> {
      const now = time(nowValue, "now");
      return database.prepare(`
        UPDATE pairing_codes SET consumed_at = ?
        WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?
        RETURNING ${pairingColumns}
      `).bind(now, hash(codeHash), now).first<PairingCodeRecord>();
    },
  };
}

export function createDeviceCredentialRepository(database: ControlPlaneDatabase) {
  return {
    async create(input: { userId: string; deviceId: string; credentialHash: string; now: number; expiresAt: number }): Promise<DeviceCredentialRecord> {
      exactInput(input, ["userId", "deviceId", "credentialHash", "now", "expiresAt"]);
      const now = time(input.now, "now");
      const row = await database.prepare(`
        INSERT INTO device_credentials (device_id, user_id, credential_hash, expires_at, revoked_at, created_at)
        SELECT id, user_id, ?, ?, NULL, ? FROM devices
        WHERE user_id = ? AND id = ? AND status = 'active'
        ON CONFLICT(device_id) DO UPDATE SET credential_hash = excluded.credential_hash,
          expires_at = excluded.expires_at, revoked_at = NULL, created_at = excluded.created_at
        RETURNING ${credentialColumns}
      `).bind(hash(input.credentialHash), expiry(input.expiresAt, now), now,
        id(input.userId, "userId"), id(input.deviceId, "deviceId"))
        .first<DeviceCredentialRecord>();
      if (!row) throw new Error("owned active device not found");
      return row;
    },
    verifyForAuthenticatedDevice(deviceId: string, credentialHash: string, nowValue: number): Promise<DeviceCredentialRecord | null> {
      const now = time(nowValue, "now");
      return database.prepare(`
        SELECT ${credentialColumns} FROM device_credentials
        WHERE device_id = ? AND credential_hash = ? AND revoked_at IS NULL AND expires_at > ?
      `).bind(id(deviceId, "deviceId"), hash(credentialHash), now).first<DeviceCredentialRecord>();
    },
    async revoke(userId: string, deviceId: string, nowValue: number): Promise<boolean> {
      const result = await database.prepare(`
        UPDATE device_credentials SET revoked_at = COALESCE(revoked_at, ?)
        WHERE user_id = ? AND device_id = ?
      `).bind(time(nowValue, "now"), id(userId, "userId"), id(deviceId, "deviceId")).run();
      return changed(result);
    },
  };
}

export function createDeviceNonceRepository(database: ControlPlaneDatabase) {
  return {
    async claim(input: { id: string; userId: string; deviceId: string; nonce: string; timestamp: number; expiresAt: number; now: number }): Promise<boolean> {
      exactInput(input, ["id", "userId", "deviceId", "nonce", "timestamp", "expiresAt", "now"]);
      const now = time(input.now, "now");
      const result = await database.prepare(`
        INSERT OR IGNORE INTO device_nonces (id, device_id, user_id, nonce, timestamp, expires_at)
        SELECT ?, id, user_id, ?, ?, ? FROM devices
        WHERE user_id = ? AND id = ? AND status = 'active'
      `).bind(id(input.id, "nonceId"), nonce(input.nonce), time(input.timestamp, "timestamp"),
        expiry(input.expiresAt, now), id(input.userId, "userId"), id(input.deviceId, "deviceId")).run();
      return changed(result);
    },
    async purgeExpired(userId: string, deviceId: string, nowValue: number, maximum: number): Promise<number> {
      const result = await database.prepare(`
        DELETE FROM device_nonces WHERE id IN (
          SELECT id FROM device_nonces WHERE user_id = ? AND device_id = ? AND expires_at <= ?
          ORDER BY expires_at ASC, id ASC LIMIT ?
        )
      `).bind(id(userId, "userId"), id(deviceId, "deviceId"), time(nowValue, "now"), limit(maximum)).run();
      if (!result.success) throw new Error("nonce purge failed");
      return result.meta.changes ?? 0;
    },
  };
}
