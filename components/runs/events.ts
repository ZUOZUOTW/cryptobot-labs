export const CLOUD_RUNS_REFRESH_EVENT = "cloud-runs:refresh";

export const refreshCloudRuns = (): void => {
  window.dispatchEvent(new Event(CLOUD_RUNS_REFRESH_EVENT));
};
