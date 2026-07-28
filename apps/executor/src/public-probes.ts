export interface PublicProbeBody {
  status: "ok" | "ready" | "not-ready";
}

export const publicHealthProbe = (): PublicProbeBody => ({ status: "ok" });

export const publicReadinessProbe = (ready: boolean): PublicProbeBody => ({
  status: ready ? "ready" : "not-ready",
});
