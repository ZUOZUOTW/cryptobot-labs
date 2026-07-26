const REVISION = /^[a-f0-9]{40}$/;

export interface ExecutorRuntimeMetadata {
  revision: string;
  startedAt: number;
}

export function executorRuntimeMetadata(
  environment: Readonly<Record<string, string | undefined>>,
  startedAt: number,
): ExecutorRuntimeMetadata {
  const candidate = environment.EXECUTOR_BUILD_REVISION;
  return Object.freeze({
    revision: typeof candidate === "string" && REVISION.test(candidate) ? candidate : "development",
    startedAt: Number.isSafeInteger(startedAt) && startedAt >= 0 ? startedAt : 0,
  });
}
