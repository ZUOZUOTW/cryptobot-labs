import type { ControlPlaneDatabase } from "../index";
import { displayName, exactInput, id, time } from "./shared";

export interface UserRecord {
  id: string;
  normalizedEmail: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

export function normalizeUserEmail(value: string): string {
  if (typeof value !== "string") throw new Error("email is invalid");
  const email = value.trim().toLowerCase();
  const parts = email.split("@");
  const domainLabels = parts.length === 2 ? parts[1]!.split(".") : [];
  if (email.length < 3 || email.length > 254 || parts.length !== 2 || parts[0]!.length > 64
    || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]!) || parts[0]!.includes("..")
    || domainLabels.length < 2 || domainLabels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("email is invalid");
  }
  return email;
}

export function createUserRepository(database: ControlPlaneDatabase) {
  return {
    async upsertIdentity(input: { id: string; email: string; displayName: string; now: number }): Promise<UserRecord> {
      exactInput(input, ["id", "email", "displayName", "now"]);
      const userId = id(input.id, "userId");
      const now = time(input.now, "now");
      const row = await database.prepare(`
        INSERT INTO users (id, normalized_email, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          normalized_email = excluded.normalized_email,
          display_name = excluded.display_name,
          updated_at = excluded.updated_at
        RETURNING id, normalized_email AS normalizedEmail, display_name AS displayName,
          created_at AS createdAt, updated_at AS updatedAt
      `).bind(userId, normalizeUserEmail(input.email), displayName(input.displayName), now, now).first<UserRecord>();
      if (!row) throw new Error("identity upsert failed");
      return row;
    },

    getById(userId: string): Promise<UserRecord | null> {
      return database.prepare(`
        SELECT id, normalized_email AS normalizedEmail, display_name AS displayName,
          created_at AS createdAt, updated_at AS updatedAt
        FROM users WHERE id = ?
      `).bind(id(userId, "userId")).first<UserRecord>();
    },
  };
}
