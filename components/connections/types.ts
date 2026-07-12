export type ConnectionPermissions = {
  read: boolean;
  spotTrade: boolean;
  futuresTrade: boolean;
  withdrawal: boolean;
};

export type ConnectionSummary = {
  provider: "WEEX";
  maskedApiKeySuffix: string | null;
  permissions: ConnectionPermissions;
  verifiedAt: number | null;
  status: "verified" | "erased";
  hasLocalCredential: boolean;
};

export type ConnectionDevice = {
  id: string;
  name: string;
  platform: "macos" | "windows";
  deviceStatus: "active";
  lastSeenAt: number | null;
  connection: ConnectionSummary | null;
};
