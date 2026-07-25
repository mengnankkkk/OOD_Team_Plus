import { beforeEach, describe, expect, it } from "vitest";

import { TEST_USER_ID, seedAuthenticatedUser } from "@tests/helpers/auth";
import { getDatabase, isoNow } from "@/server/http/context";

import { createArtifact, previewArtifact } from "./service";

beforeEach(() => {
  seedAuthenticatedUser();
  const db = getDatabase();
  for (const table of ["message_artifacts", "generated_artifact_versions", "generated_artifacts", "messages", "conversation_sessions"]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
  const now = isoNow();
  db.prepare("INSERT INTO conversation_sessions (id,user_id,title,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)")
    .run("report-conversation", TEST_USER_ID, "资产深度报告", now, now);
  db.prepare("INSERT INTO messages (id,session_id,role,content,created_at) VALUES (?,?,'assistant',?,?)")
    .run("report-message", "report-conversation", "Agent 已完成组合诊断。", now);
  db.close();
});

describe("createArtifact", () => {
  it("stores supplied Agent Markdown instead of replacing it with a generated table", () => {
    const created = createArtifact({
      userId: TEST_USER_ID,
      sessionId: "report-conversation",
      sourceMessageId: "report-message",
      artifactType: "MARKDOWN",
      title: "资产深度报告",
      markdownContent: "# 执行摘要\n\n组合集中度需要关注。",
      sourceRows: [{ symbol: "000001.SZ", marketValue: "1110" }],
      sourceColumns: [{ name: "symbol" }, { name: "marketValue" }],
    });

    const preview = previewArtifact(TEST_USER_ID, created.artifactId) as { type: string; markdown?: string } | null;

    expect(preview).toMatchObject({
      type: "MARKDOWN",
      markdown: expect.stringContaining("组合集中度需要关注"),
    });
    expect(String(preview?.markdown)).not.toContain("| symbol | marketValue |");
  });
});
