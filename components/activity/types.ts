export type ActivityActor = "user" | "device";

export type ActivityItem = {
  id: string;
  type: string;
  occurredAt: number;
  actorType: ActivityActor;
  deviceId: string | null;
  deploymentId: string | null;
  deploymentVersion: number | null;
  strategyVersionId: string | null;
  strategyVersion: number | null;
  configurationHash: string | null;
  scriptHash: string | null;
  reason: string | null;
  riskDecision: string | null;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  status: string | null;
  correlationId: string;
};

export type ActivityList = {
  items: ActivityItem[];
  nextCursor: string | null;
};
