import { describe, expect, it } from "vitest";

import { createExtensionError, ExtensionErrorCode } from "@/server/extensions/errors/codes";
import {
  DataQueryRequestSchema,
  GeneratedArtifactRequestSchema,
} from "@/server/extensions/schemas";

describe("DataQueryRequestSchema", () => {
  it("rejects invalid outputMode", () => {
    expect(() =>
      DataQueryRequestSchema.parse({ outputMode: "INVALID", questionText: "q", requestedDatasets: ["d"] }),
    ).toThrow();
  });

  it("accepts valid request", () => {
    const request = DataQueryRequestSchema.parse({
      outputMode: "SQL_ONLY",
      questionText: "q",
      requestedDatasets: ["d"],
    });

    expect(request.requestedLimit).toBe(2000);
  });
});

describe("GeneratedArtifactRequestSchema", () => {
  it("rejects when no source FK provided", () => {
    expect(() => GeneratedArtifactRequestSchema.parse({ artifactType: "ECHARTS_OPTION", title: "t" })).toThrow();
  });

  it("accepts with sourceMessageId", () => {
    GeneratedArtifactRequestSchema.parse({
      artifactType: "ECHARTS_OPTION",
      title: "t",
      sourceMessageId: "msg1",
    });
  });
});

describe("createExtensionError", () => {
  it("creates error with code, message, retryable", () => {
    const error = createExtensionError(ExtensionErrorCode.QUERY_TIMEOUT, "timeout", undefined, true);

    expect(error.code).toBe("QUERY_TIMEOUT");
    expect(error.retryable).toBe(true);
  });
});
