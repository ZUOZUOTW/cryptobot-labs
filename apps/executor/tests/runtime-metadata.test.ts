import { describe, expect, it } from "vitest";

import { executorRuntimeMetadata } from "../src/runtime-metadata";

describe("executor runtime metadata", () => {
  it("exposes an exact source revision and process start time", () => {
    expect(executorRuntimeMetadata({
      EXECUTOR_BUILD_REVISION: "a".repeat(40),
    }, 1_700_000_000_000)).toEqual({
      revision: "a".repeat(40),
      startedAt: 1_700_000_000_000,
    });
  });

  it("does not expose malformed environment metadata", () => {
    expect(executorRuntimeMetadata({
      EXECUTOR_BUILD_REVISION: "main; printenv",
    }, Number.NaN)).toEqual({
      revision: "development",
      startedAt: 0,
    });
  });
});
