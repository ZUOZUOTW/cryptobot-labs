import { describe, expect, it, vi } from "vitest";
import type { ActivityEvidenceRecord } from "../db/repositories";
import { createActivityHandlers, projectActivityItem, serializeActivityCsv } from "../lib/server/activity-export";

const record = (overrides: Partial<ActivityEvidenceRecord> = {}): ActivityEvidenceRecord => ({
  id: "evt_1", userId: "usr_owner", actorType: "device", actorId: "dev_1", deviceId: "dev_1",
  deploymentId: "run_1", strategyVersionId: null, type: "risk-block", correlationId: "corr_1",
  payloadJson: JSON.stringify({ version: 1, expectedDeploymentVersion: 4,
    payload: { code: "=FORMULA", symbol: "BTCUSDT", message: "+danger" } }),
  occurredAt: 1_700_000_000_000, createdAt: 1_700_000_000_001,
  deploymentConfigurationHash: "a".repeat(64), deploymentStrategyVersionId: "sv_1",
  strategyVersion: 7, strategyConfigHash: "b".repeat(64), strategySourceHash: "c".repeat(64),
  clientOrderId: "client_1", exchangeOrderId: "exchange_1", orderStatus: "risk-rejected", ...overrides,
});

const dependencies = (items = [record()]) => ({
  auth: {
    identityProvider: { getIdentity: vi.fn().mockResolvedValue({ email: "owner@example.com", displayName: "Owner" }) },
    userRepository: { upsertIdentity: vi.fn().mockResolvedValue({ id: "usr_owner" }) },
    deriveUserId: vi.fn().mockResolvedValue("usr_owner"), now: () => 1,
  },
  activity: { listActivityForUser: vi.fn().mockResolvedValue({ items, nextCursor: null }) },
});

describe("activity projection and export", () => {
  it("projects only allowlisted evidence and never exposes actor user ids or raw payload", () => {
    const projected = projectActivityItem(record());
    expect(projected).toMatchObject({ actorType: "device", deviceId: "dev_1", deploymentVersion: 4,
      strategyVersionId: "sv_1", strategyVersion: 7, reason: "+danger", riskDecision: "=FORMULA",
      clientOrderId: null, exchangeOrderId: null, status: null });
    expect(projected).not.toHaveProperty("actorId");
    expect(projected).not.toHaveProperty("userId");
    expect(projected).not.toHaveProperty("payloadJson");
    expect(JSON.stringify(projected)).not.toContain("usr_owner");
  });

  it("projects an exact payload allowlist for each supported device event type", () => {
    const wrapped = (type: string, payload: Record<string, unknown>, overrides: Partial<ActivityEvidenceRecord> = {}) =>
      projectActivityItem(record({ type, payloadJson: JSON.stringify({ version: 1, expectedDeploymentVersion: 4,
        payload }),
      clientOrderId: "database-client", exchangeOrderId: "database-exchange", orderStatus: "filled", ...overrides }));

    expect(wrapped("order-state", { mode: "paper", deploymentState: "running", order: {
      clientOrderId: "payload-client", exchangeOrderId: "payload-exchange", state: "acknowledged" }, fills: [] })).toMatchObject({
      clientOrderId: "database-client", exchangeOrderId: "database-exchange", status: "filled",
      reason: null, riskDecision: null,
    });
    expect(wrapped("signal", { symbol: "BTCUSDT", action: "enter", side: "buy", quantity: "1",
      price: "100", reason: "entry" })).toMatchObject({
      reason: "entry", status: "enter", riskDecision: null, clientOrderId: null, exchangeOrderId: null,
    });
    expect(wrapped("deployment-state", { reason: "operator", state: "paused" })).toMatchObject({
      reason: "operator", status: "paused", riskDecision: null, clientOrderId: null,
    });
    expect(wrapped("key-erased", { reason: "user-request" })).toMatchObject({
      reason: "user-request", status: null, riskDecision: null, clientOrderId: null,
    });
    expect(wrapped("connection-verified", { provider: "WEEX", maskedApiKeySuffix: "****A1B2" }))
      .toMatchObject({ reason: null, status: null, riskDecision: null, clientOrderId: null });
    expect(wrapped("signal", { symbol: "BTCUSDT", action: "enter", side: "buy", quantity: "1",
      price: "100", reason: "must stay opaque", extra: true })).toMatchObject({ reason: null, status: null });
  });

  it("keeps unknown and user-authored payloads opaque even when values resemble safe fields", () => {
    const secretPayload = JSON.stringify({ version: 1, expectedDeploymentVersion: 9,
      payload: { reason: "api-secret-value", status: "secret-status", action: "secret-action",
        code: "secret-code", message: "secret-message", order: { clientOrderId: "secret-order", state: "secret-state" } } });
    for (const candidate of [record({ type: "unknown-event", payloadJson: secretPayload,
      clientOrderId: null, exchangeOrderId: null, orderStatus: null }), record({ actorType: "user", actorId: "usr_owner",
      deviceId: null, type: "risk-block", payloadJson: secretPayload, clientOrderId: null,
      exchangeOrderId: null, orderStatus: null })]) {
      const projected = projectActivityItem(candidate);
      expect(projected).toMatchObject({ deploymentId: null, deploymentVersion: null, reason: null,
        riskDecision: null, clientOrderId: null, exchangeOrderId: null, status: null });
      expect(JSON.stringify(projected)).not.toContain("secret");
    }
  });

  it("keeps heartbeat ownership evidence and projects only exact agent errors", () => {
    const heartbeat = projectActivityItem(record({ type: "heartbeat", payloadJson: JSON.stringify({ version: 1,
      expectedDeploymentVersion: 4, payload: { heartbeat: { health: "healthy" }, positionIds: [] } }) }));
    expect(heartbeat).toMatchObject({ deploymentId: "run_1", deploymentVersion: 4, reason: null, status: null });
    const agentError = projectActivityItem(record({ type: "agent-error", payloadJson: JSON.stringify({ version: 1,
      expectedDeploymentVersion: 4, payload: { code: "E_NETWORK", message: "connection unavailable", retryable: true } }) }));
    expect(agentError).toMatchObject({ deploymentId: "run_1", deploymentVersion: 4,
      reason: "connection unavailable", status: "E_NETWORK" });
    const extra = projectActivityItem(record({ type: "agent-error", payloadJson: JSON.stringify({ version: 1,
      expectedDeploymentVersion: 4, payload: { code: "E_NETWORK", message: "must stay opaque", retryable: true, extra: true } }) }));
    expect(extra).toMatchObject({ reason: null, status: null });
  });

  it("uses fixed CSV columns and neutralizes spreadsheet formula prefixes after Unicode leaders", () => {
    const base = projectActivityItem(record());
    const csv = serializeActivityCsv([{ ...base, reason: "=x\nsecond" }]);
    expect(csv.split("\r\n")[0]).toBe("id,type,occurredAt,actorType,deviceId,deploymentId,deploymentVersion,strategyVersionId,strategyVersion,configurationHash,scriptHash,reason,riskDecision,clientOrderId,exchangeOrderId,status,correlationId");
    expect(csv).toContain("'=x\nsecond");
    expect(csv).not.toContain("payloadJson");
  });

  it.each([
    ["ASCII space", "  =SUM(A1:A2)", true],
    ["tab and carriage return", "\t\r+cmd", true],
    ["NBSP", "\u00a0-1", true],
    ["FEFF format character", "\ufeff@cmd", true],
    ["fullwidth equals", "＝SUM(A1:A2)", true],
    ["fullwidth plus after Unicode leaders", "\u00a0\ufeff＋1", true],
    ["ordinary safe value", "completed + verified", false],
    ["quoted multiline safe value", "safe \"quote\"\nnext line", false],
  ])("handles %s CSV cells", (_label, value, dangerous) => {
    const base = projectActivityItem(record());
    const csv = serializeActivityCsv([{ ...base, reason: value }]);
    const escaped = value.replace(/"/g, '""');
    const expected = `"${dangerous ? "'" : ""}${escaped}"`;
    expect(csv).toContain(expected);
    if (dangerous) expect(csv).not.toContain(`,"${escaped}",`);
  });

  it("enforces authentication, owner scope, opaque cursor, bounded range, limits, and exact query keys", async () => {
    const deps = dependencies(); const handlers = createActivityHandlers(deps);
    const response = await handlers.list(new Request("https://app.example/api/activity?limit=1&from=100&to=200"));
    expect(response.status).toBe(200);
    expect(deps.activity.listActivityForUser).toHaveBeenCalledWith("usr_owner", { limit: 1, from: 100, to: 200 });
    expect(JSON.stringify(await response.json())).not.toContain("usr_owner");
    for (const url of [
      "https://app.example/api/activity?limit=0", "https://app.example/api/activity?limit=101",
      "https://app.example/api/activity?from=200&to=100", "https://app.example/api/activity?from=0&to=40000000000",
      "https://app.example/api/activity?unknown=1", "https://app.example/api/activity?cursor=not-a-cursor",
    ]) expect((await handlers.list(new Request(url))).status).toBe(400);
    const anonymous = dependencies(); anonymous.auth.identityProvider.getIdentity.mockResolvedValue(null);
    expect((await createActivityHandlers(anonymous).list(new Request("https://app.example/api/activity"))).status).toBe(401);
  });

  it("exports JSON or UTF-8 CSV without secret-bearing fields", async () => {
    const handlers = createActivityHandlers(dependencies());
    const json = await handlers.export(new Request("https://app.example/api/activity/export?format=json"));
    expect(json.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(JSON.stringify(await json.json())).not.toMatch(/payloadJson|userId|actorId|usr_owner/);
    const csv = await handlers.export(new Request("https://app.example/api/activity/export?format=csv"));
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toContain("cryptobot-labs-activity.csv");
    expect(await csv.text()).not.toMatch(/payloadJson|userId|actorId|usr_owner/);
    expect((await handlers.export(new Request("https://app.example/api/activity/export?format=xml"))).status).toBe(400);
  });
});
