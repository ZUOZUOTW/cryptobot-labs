import { WeexApiError } from "./errors";

/** WEEX private requests must remain inside the documented thirty-second window. */
export const PRIVATE_REQUEST_WINDOW_MS = 30_000;

export class WeexClock {
  private offsetMs: number | undefined;
  private synchronizedAtLocalMs: number | undefined;

  constructor(private readonly localNow: () => number = Date.now) {}

  recordServerTime(serverMs: number, sentMs: number, receivedMs: number): void {
    if (![serverMs, sentMs, receivedMs].every(Number.isFinite) || sentMs < 0 || receivedMs < sentMs) {
      throw new WeexApiError("Invalid clock synchronization sample", {
        category: "clock", retryable: false,
      });
    }
    const midpoint = sentMs + (receivedMs - sentMs) / 2;
    const recordedAt = this.localNow();
    if (!Number.isFinite(recordedAt)) {
      throw new WeexApiError("Invalid local clock", { category: "clock", retryable: false });
    }
    this.offsetMs = serverMs - midpoint;
    this.synchronizedAtLocalMs = recordedAt;
  }

  now(): number {
    const local = this.localNow();
    if (!Number.isFinite(local)) {
      throw new WeexApiError("Invalid local clock", { category: "clock", retryable: false });
    }
    return local + (this.offsetMs ?? 0);
  }

  assertPrivateRequestWindow(requestTimestampMs: number): void {
    const local = this.localNow();
    if (!Number.isFinite(local) || !Number.isFinite(requestTimestampMs)) {
      throw new WeexApiError("Invalid clock timestamp", { category: "clock", retryable: false });
    }
    if (this.offsetMs === undefined || this.synchronizedAtLocalMs === undefined) {
      throw new WeexApiError("Clock has never been synchronized", { category: "clock", retryable: false });
    }
    const syncAge = local - this.synchronizedAtLocalMs;
    if (syncAge < 0 || syncAge > PRIVATE_REQUEST_WINDOW_MS) {
      throw new WeexApiError("Clock synchronization is stale", { category: "clock", retryable: false });
    }
    if (Math.abs(this.now() - requestTimestampMs) >= PRIVATE_REQUEST_WINDOW_MS) {
      throw new WeexApiError("Request is outside the WEEX 30-second private-request safety window", {
        category: "clock", retryable: false,
      });
    }
  }
}
