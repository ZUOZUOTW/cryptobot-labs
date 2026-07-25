const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface PairingExpiryGuard {
  schedule(expiresAt: number): Promise<void>;
  cancel(): void;
}

export interface PairingExpiryGuardOptions {
  now?: () => number;
  onExpired(): void | Promise<void>;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Stops execution from relying on control-plane connectivity to notice a
 * device credential expiry. Long expiries are checked in bounded timer hops.
 */
export function createPairingExpiryGuard(options: PairingExpiryGuardOptions): PairingExpiryGuard {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const cancel = (): void => {
    generation += 1;
    if (timer) clearTimer(timer);
    timer = null;
  };

  const check = async (expiresAt: number, currentGeneration: number): Promise<void> => {
    if (currentGeneration !== generation) return;
    const observedAt = now();
    if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("System clock is invalid");
    const remaining = expiresAt - observedAt;
    if (remaining <= 0) {
      timer = null;
      await options.onExpired();
      return;
    }
    timer = setTimer(() => { void check(expiresAt, currentGeneration); }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  };

  return Object.freeze({
    async schedule(expiresAt: number) {
      if (!Number.isSafeInteger(expiresAt) || expiresAt < 1) throw new Error("Device credential expiry is invalid");
      cancel();
      const currentGeneration = generation;
      await check(expiresAt, currentGeneration);
    },
    cancel,
  });
}
