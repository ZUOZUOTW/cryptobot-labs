import type { ControlPlaneDatabase } from "../../db";
import { displayName, exactInput, id, publicKeyJwkJson, time } from "../../db/repositories/shared";

const CODE_TTL_MS = 300_000;
const BOOTSTRAP_TTL_MS = 60_000;
const CREDENTIAL_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ACTIVE_CODES = 3;
const MAX_RECENT_CODES = 5;
const COLLISION_ATTEMPTS = 4;
const CODE = /^CBL-[A-Za-z0-9_-]{22}$/;
const BOOTSTRAP = /^bst_[A-Za-z0-9_-]{22}$/;
const CHALLENGE = /^chl_[A-Za-z0-9_-]{43}$/;

export class PairingError extends Error {
  constructor() { super("pairing request is invalid, expired, or used"); this.name = "PairingError"; }
}

export interface PairingServiceDependencies {
  database: ControlPlaneDatabase;
  randomBytes?: (length: number) => Uint8Array;
  verifyBootstrapProof?: (input: { deviceId: string; challenge: string; publicKeyJwk: string; proof: unknown }) => Promise<boolean>;
}

const productionRandomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));
const base64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const bytes = (random: (length: number) => Uint8Array, length: number): Uint8Array => {
  const value = random(length);
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new Error("CSPRNG returned an invalid byte sequence");
  return new Uint8Array(value);
};
const sha256 = async (value: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((item) => item.toString(16).padStart(2, "0")).join("");
};
const strictPublicJwk = (value: unknown): string => {
  const encoded = publicKeyJwkJson(value);
  const x = (JSON.parse(encoded) as { x: string }).x;
  let decoded: Uint8Array;
  try {
    const standard = x.replace(/-/g, "+").replace(/_/g, "/");
    const padded = `${standard}${"=".repeat((4 - (standard.length % 4)) % 4)}`;
    decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch { throw new Error("public JWK x is invalid"); }
  if (decoded.byteLength !== 32 || base64url(decoded) !== x) throw new Error("public JWK x must be canonical 32-byte base64url");
  return encoded;
};

export function createPairingService(dependencies: PairingServiceDependencies) {
  const database = dependencies.database;
  const random = dependencies.randomBytes ?? productionRandomBytes;

  return {
    async issueCode(input: { userId: string; now: number }): Promise<{ code: string; expiresAt: number }> {
      exactInput(input, ["userId", "now"]);
      const owner = id(input.userId, "userId");
      const now = time(input.now, "now");
      for (let attempt = 0; attempt < COLLISION_ATTEMPTS; attempt += 1) {
        const entropy = bytes(random, 16);
        const code = `CBL-${base64url(entropy)}`;
        const codeHash = await sha256(code);
        const pairId = `pair_${base64url(bytes(random, 16))}`;
        try {
          await database.batch([
            database.prepare(`INSERT INTO pairing_codes
              (id,user_id,code_hash,expires_at,consumed_at,created_at)
              SELECT ?,u.id,?,?,NULL,? FROM users u WHERE u.id=?
                AND (SELECT COUNT(*) FROM pairing_codes p WHERE p.user_id=u.id
                  AND p.consumed_at IS NULL AND p.expires_at>?) < ?
                AND (SELECT COUNT(*) FROM pairing_codes p WHERE p.user_id=u.id AND p.created_at>=?) < ?`)
              .bind(pairId, codeHash, now + CODE_TTL_MS, now, owner, now, MAX_ACTIVE_CODES,
                Math.max(0, now - CODE_TTL_MS), MAX_RECENT_CODES),
            database.prepare(`INSERT INTO pairing_codes
              (id,user_id,code_hash,expires_at,consumed_at,created_at)
              SELECT ?,NULL,?,?,NULL,? WHERE NOT EXISTS (
                SELECT 1 FROM pairing_codes WHERE id=? AND user_id=? AND code_hash=? AND expires_at=?
                  AND consumed_at IS NULL AND created_at=?)`)
              .bind(pairId, codeHash, now + CODE_TTL_MS, now, pairId, owner, codeHash, now + CODE_TTL_MS, now),
          ]);
          return { code, expiresAt: now + CODE_TTL_MS };
        } catch {
          // A hash/ID collision is retried with fresh CSPRNG output; the bounded loop prevents livelock.
        }
      }
      throw new PairingError();
    },

    async consumeCode(input: { code: string; name: string; platform: "macos" | "windows"; publicKeyJwk: unknown; now: number }): Promise<{
      deviceId: string; bootstrapToken: string; challenge: string; expiresAt: number;
    }> {
      exactInput(input, ["code", "name", "platform", "publicKeyJwk", "now"]);
      if (typeof input.code !== "string" || !CODE.test(input.code)) throw new PairingError();
      if (input.platform !== "macos" && input.platform !== "windows") throw new PairingError();
      const now = time(input.now, "now");
      const codeHash = await sha256(input.code);
      const name = displayName(input.name, "device name");
      const publicJwk = strictPublicJwk(input.publicKeyJwk);
      for (let attempt = 0; attempt < COLLISION_ATTEMPTS; attempt += 1) {
        const deviceId = `dev_${base64url(bytes(random, 16))}`;
        const bootstrapToken = `bst_${base64url(bytes(random, 16))}`;
        const challenge = `chl_${base64url(bytes(random, 32))}`;
        const bootstrapId = `boot_${base64url(bytes(random, 16))}`;
        const bootstrapHash = await sha256(bootstrapToken);
        const challengeHash = await sha256(challenge);
        const expiresAt = now + BOOTSTRAP_TTL_MS;
        try {
          await database.batch([
            database.prepare(`INSERT INTO devices
              (id,user_id,name,platform,public_key_jwk,status,paired_at,last_seen_at,revoked_at,created_at,updated_at)
              SELECT ?,p.user_id,?,?,?,'pending',?,NULL,NULL,?,? FROM pairing_codes p
              WHERE p.code_hash=? AND p.consumed_at IS NULL AND p.expires_at>?`)
              .bind(deviceId, name, input.platform, publicJwk, now, now, now, codeHash, now),
            database.prepare(`UPDATE pairing_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?
              AND EXISTS (SELECT 1 FROM devices WHERE id=? AND user_id=pairing_codes.user_id AND status='pending')`)
              .bind(now, codeHash, now, deviceId),
            database.prepare(`INSERT INTO device_bootstraps
              (id,user_id,device_id,pairing_code_id,bootstrap_hash,challenge_hash,expires_at,consumed_at,created_at)
              SELECT ?,d.user_id,d.id,p.id,?,?,?,NULL,? FROM devices d JOIN pairing_codes p ON p.user_id=d.user_id
              WHERE d.id=? AND d.status='pending' AND p.code_hash=? AND p.consumed_at=?`)
              .bind(bootstrapId, bootstrapHash, challengeHash, expiresAt, now, deviceId, codeHash, now),
            database.prepare(`INSERT INTO device_bootstraps
              (id,user_id,device_id,pairing_code_id,bootstrap_hash,challenge_hash,expires_at,consumed_at,created_at)
              SELECT ?,NULL,?,?,?,?,?,NULL,? WHERE NOT EXISTS (
                SELECT 1 FROM device_bootstraps b JOIN devices d ON d.id=b.device_id AND d.user_id=b.user_id
                WHERE b.id=? AND b.device_id=? AND b.bootstrap_hash=? AND b.challenge_hash=? AND b.expires_at=?
                  AND b.consumed_at IS NULL AND d.public_key_jwk=? AND d.status='pending')`)
              .bind(bootstrapId, deviceId, bootstrapId, bootstrapHash, challengeHash, expiresAt, now,
                bootstrapId, deviceId, bootstrapHash, challengeHash, expiresAt, publicJwk),
          ]);
          return { deviceId, bootstrapToken, challenge, expiresAt };
        } catch {
          // Both invalid/replayed codes and random collisions share one public error after bounded attempts.
        }
      }
      throw new PairingError();
    },

    async completeActivation(input: { deviceId: string; bootstrapToken: string; challenge: string;
      proof: unknown; now: number }): Promise<{ credential: string; expiresAt: number }> {
      exactInput(input, ["deviceId", "bootstrapToken", "challenge", "proof", "now"]);
      if (typeof input.bootstrapToken !== "string" || !BOOTSTRAP.test(input.bootstrapToken)
        || typeof input.challenge !== "string" || !CHALLENGE.test(input.challenge)) throw new PairingError();
      const deviceId = id(input.deviceId, "deviceId");
      const now = time(input.now, "now");
      const bootstrapHash = await sha256(input.bootstrapToken);
      const challengeHash = await sha256(input.challenge);
      const pending = await database.prepare(`SELECT d.public_key_jwk AS publicKeyJwk FROM device_bootstraps b
        JOIN devices d ON d.id=b.device_id AND d.user_id=b.user_id
        WHERE b.device_id=? AND b.bootstrap_hash=? AND b.challenge_hash=?
          AND b.consumed_at IS NULL AND b.expires_at>? AND d.status='pending'`)
        .bind(deviceId, bootstrapHash, challengeHash, now).first<{ publicKeyJwk: string }>();
      if (!pending || !dependencies.verifyBootstrapProof) throw new PairingError();
      let proofValid = false;
      try {
        proofValid = await dependencies.verifyBootstrapProof({ deviceId, challenge: input.challenge,
          publicKeyJwk: pending.publicKeyJwk, proof: input.proof });
      } catch {
        // Proof verifier internals are never exposed as pairing oracles.
      }
      if (!proofValid) throw new PairingError();
      for (let attempt = 0; attempt < COLLISION_ATTEMPTS; attempt += 1) {
        const credential = `cred_${base64url(bytes(random, 32))}`;
        const credentialHash = await sha256(credential);
        const expiresAt = now + CREDENTIAL_TTL_MS;
        try {
          await database.batch([
            database.prepare(`INSERT INTO device_credentials
              (device_id,user_id,credential_hash,expires_at,revoked_at,created_at)
              SELECT d.id,d.user_id,?,?,NULL,? FROM device_bootstraps b
              JOIN devices d ON d.id=b.device_id AND d.user_id=b.user_id
              WHERE b.device_id=? AND b.bootstrap_hash=? AND b.challenge_hash=?
                AND b.consumed_at IS NULL AND b.expires_at>? AND d.status='pending'`)
              .bind(credentialHash, expiresAt, now, deviceId, bootstrapHash, challengeHash, now),
            database.prepare(`UPDATE device_bootstraps SET consumed_at=? WHERE device_id=? AND bootstrap_hash=?
              AND challenge_hash=? AND consumed_at IS NULL AND expires_at>?
              AND EXISTS (SELECT 1 FROM device_credentials WHERE device_id=? AND credential_hash=?)`)
              .bind(now, deviceId, bootstrapHash, challengeHash, now, deviceId, credentialHash),
            database.prepare(`UPDATE devices SET status='active',paired_at=?,updated_at=? WHERE id=? AND status='pending'
              AND EXISTS (SELECT 1 FROM device_bootstraps WHERE device_id=? AND bootstrap_hash=?
                AND challenge_hash=? AND consumed_at=?)
              AND EXISTS (SELECT 1 FROM device_credentials WHERE device_id=? AND credential_hash=?)`)
              .bind(now, now, deviceId, deviceId, bootstrapHash, challengeHash, now, deviceId, credentialHash),
            database.prepare(`INSERT INTO device_credentials
              (device_id,user_id,credential_hash,expires_at,revoked_at,created_at)
              SELECT ?,NULL,?,?,NULL,? WHERE NOT EXISTS (
                SELECT 1 FROM device_credentials c JOIN devices d ON d.id=c.device_id AND d.user_id=c.user_id
                JOIN device_bootstraps b ON b.device_id=d.id AND b.user_id=d.user_id
                WHERE c.device_id=? AND c.credential_hash=? AND c.expires_at=? AND c.revoked_at IS NULL
                  AND d.status='active' AND b.bootstrap_hash=? AND b.challenge_hash=? AND b.consumed_at=?)`)
              .bind(deviceId, credentialHash, expiresAt, now, deviceId, credentialHash, expiresAt,
                bootstrapHash, challengeHash, now),
          ]);
          return { credential, expiresAt };
        } catch {
          // Invalid/replayed bootstrap material and credential collisions are intentionally indistinguishable.
        }
      }
      throw new PairingError();
    },
  };
}
