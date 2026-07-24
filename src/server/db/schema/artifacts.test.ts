import { describe, expect, it } from "vitest";

import { generatedArtifactInsertSchema, versionInsertSchema } from "./artifacts";

describe("VersionInsert", () => {
  it("rejects both contentJson and contentMarkdown set", () => {
    const result = versionInsertSchema.safeParse({
      id: "v1",
      artifactId: "a1",
      versionNo: 1,
      contentType: "markdown",
      contentJson: "{}",
      contentMarkdown: "hello",
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects neither content set", () => {
    const result = versionInsertSchema.safeParse({
      id: "v1",
      artifactId: "a1",
      versionNo: 1,
      contentType: "markdown",
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects echarts content > 512 KiB", () => {
    const result = versionInsertSchema.safeParse({
      id: "v1",
      artifactId: "a1",
      versionNo: 1,
      contentType: "echarts_option",
      contentJson: "a".repeat(512 * 1024 + 1),
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });

  it("accepts valid echarts option", () => {
    const result = versionInsertSchema.safeParse({
      id: "v1",
      artifactId: "a1",
      versionNo: 1,
      contentType: "echarts_option",
      contentJson: "{}",
      createdAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(true);
  });
});

describe("GeneratedArtifactInsert", () => {
  it("rejects ready status with version 0", () => {
    const result = generatedArtifactInsertSchema.safeParse({
      id: "a1",
      userId: "u1",
      agentRunId: "r1",
      artifactType: "markdown",
      status: "ready",
      title: "Example",
      currentVersionNo: 0,
      sourceSnapshotJson: "{}",
      sourceSnapshotSha256: "sha256",
      provenanceJson: "{}",
      readyAt: "2026-07-24T00:00:00Z",
      createdAt: "2026-07-24T00:00:00Z",
      updatedAt: "2026-07-24T00:00:00Z",
      sourceMessageId: "m1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects no source FK", () => {
    const result = generatedArtifactInsertSchema.safeParse({
      id: "a1",
      userId: "u1",
      agentRunId: "r1",
      artifactType: "markdown",
      title: "Example",
      sourceSnapshotJson: "{}",
      sourceSnapshotSha256: "sha256",
      provenanceJson: "{}",
      createdAt: "2026-07-24T00:00:00Z",
      updatedAt: "2026-07-24T00:00:00Z",
    });

    expect(result.success).toBe(false);
  });
});
