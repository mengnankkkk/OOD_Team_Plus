import { createHash } from "node:crypto";

import { getDatabase, createId, isoNow, json, parseJson } from "@/server/http/context";
import { sanitizeEChartsOption } from "@/server/extensions/sanitizers/echarts-sanitizer";
import { sanitizeMarkdown } from "@/server/extensions/sanitizers/markdown-sanitizer";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";

import { resolveArtifactSource } from "./source";

export type ArtifactType = "ECHARTS_OPTION" | "MARKDOWN";

type ArtifactInput = {
  userId: string;
  artifactType: ArtifactType;
  title: string;
  sourceMessageId?: string;
  sourceQueryId?: string;
  sessionId?: string;
  sourceRows?: Record<string, unknown>[];
  sourceColumns?: Array<{ name: string; type?: string }>;
};

type ArtifactRow = Record<string, unknown>;

export function createArtifact(input: ArtifactInput) {
  const source = resolveArtifactSource(input);
  const rows = source.rows;
  const columns = source.columns;
  const content = input.artifactType === "MARKDOWN"
    ? createMarkdownReport(input.title, rows, columns)
    : createChartOption(input.title, rows, columns);
  const sanitized = input.artifactType === "MARKDOWN"
    ? sanitizeMarkdown(content as string)
    : sanitizeEChartsOption(content);
  if (!sanitized.valid || sanitized.sanitized === undefined) {
    throw new Error(sanitized.errors.join("; "));
  }

  const now = isoNow();
  const artifactId = createId("artifact");
  const analysisId = createId("analysis");
  const contentJson = input.artifactType === "ECHARTS_OPTION" ? JSON.stringify(sanitized.sanitized) : null;
  const contentMarkdown = input.artifactType === "MARKDOWN" ? String(sanitized.sanitized) : null;
  const serializedContent = contentJson ?? contentMarkdown ?? "";
  const contentHash = createHash("sha256").update(serializedContent).digest("hex");
  const contentSize = Buffer.byteLength(serializedContent, "utf8");
  const db = getDatabase();
  const publish = db.transaction(() => {
    db.prepare("INSERT INTO agent_runs (id, user_id, type, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)").run(analysisId, input.userId, "artifact_generation", "completed", now, now);
    db.prepare(`INSERT INTO generated_artifacts
      (id, user_id, session_id, source_message_id, source_query_id, agent_run_id, artifact_type, status,
       title, current_version_no, source_snapshot_json, source_snapshot_sha256, provenance_json,
       ready_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, 1, ?, ?, ?, ?, ?, ?)`)
      .run(artifactId, input.userId, source.sessionId, input.sourceMessageId ?? null, input.sourceQueryId ?? null,
        analysisId, input.artifactType === "ECHARTS_OPTION" ? "echarts_option" : "markdown", input.title,
        source.snapshotJson, source.snapshotSha256, json({ analysisId, modelName: "local-deterministic", algorithmVersion: "artifact-v1", sourceSnapshotSha256: source.snapshotSha256 }), now, now, now);
    db.prepare(`INSERT INTO generated_artifact_versions
      (id, artifact_id, version_no, content_type, content_json, content_markdown, content_sha256, size_bytes, created_by_type, created_by_id, edited_by, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'agent', ?, ?, ?)`)
      .run(createId("artifact_version"), artifactId, input.artifactType === "ECHARTS_OPTION" ? "echarts_option" : "markdown", contentJson, contentMarkdown, contentHash, contentSize, analysisId, input.userId, now);
    if (input.sourceMessageId && source.sourceMessageRole === "assistant") {
      db.prepare(`INSERT INTO message_artifacts
        (id,message_id,artifact_type,generated_artifact_id,display_order,created_at)
        VALUES (?,?,'generated_artifact',?,COALESCE((SELECT MAX(display_order)+1 FROM message_artifacts WHERE message_id=?),1),?)`)
        .run(createId("message_artifact"), input.sourceMessageId, artifactId, input.sourceMessageId, now);
    }
  });
  publish();
  db.close();
  void persistSseEvent({ analysisId, type: "artifact.completed", payload: { artifactId, type: input.artifactType } });
  return { artifactId, analysisId, status: "READY", version: 1 };
}

export function listArtifacts(userId: string, limit: number, filters: { sourceMessageId?: string; artifactType?: string; status?: string; sessionId?: string } = {}) {
  const db = getDatabase();
  const conditions = ["user_id = ?", "status != 'deleted'"];
  const params: unknown[] = [userId];
  if (filters.sourceMessageId) { conditions.push("source_message_id = ?"); params.push(filters.sourceMessageId); }
  if (filters.artifactType) { conditions.push("artifact_type = ?"); params.push(filters.artifactType.toLowerCase()); }
  if (filters.status) { conditions.push("status = ?"); params.push(filters.status.toLowerCase()); }
  if (filters.sessionId) { conditions.push("session_id = ?"); params.push(filters.sessionId); }
  params.push(limit);
  const rows = db.prepare(`SELECT * FROM generated_artifacts WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...params) as ArtifactRow[];
  db.close();
  return rows.map(toArtifactSummary);
}

export function getArtifact(userId: string, id: string) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM generated_artifacts WHERE id = ? AND user_id = ? AND status != 'deleted'").get(id, userId) as ArtifactRow | undefined;
  if (!row) { db.close(); return null; }
  const version = db.prepare("SELECT * FROM generated_artifact_versions WHERE artifact_id = ? AND version_no = ?").get(id, row.current_version_no) as ArtifactRow | undefined;
  db.close();
  return { ...toArtifactSummary(row), sourceSnapshot: parseJson(row.source_snapshot_json as string, {}), provenance: parseJson(row.provenance_json as string, {}), version: version ? toVersion(version) : null };
}

export function previewArtifact(userId: string, id: string) {
  const artifact = getArtifact(userId, id);
  if (!artifact) return null;
  const version = artifact.version;
  if (!version) return artifact;
  const content = artifact.type === "MARKDOWN" ? (version.contentMarkdown ?? "") : parseJson(String(version.contentJson ?? "{}"), {});
  return { id, type: artifact.type, version: artifact.currentVersion, ...(artifact.type === "MARKDOWN" ? { markdown: String(version.contentMarkdown ?? ""), sanitizedHtml: markdownToHtml(String(version.contentMarkdown ?? "")) } : { option: content }), contentSha256: createHash("sha256").update(typeof content === "string" ? content : JSON.stringify(content)).digest("hex") };
}

export function updateArtifact(userId: string, id: string, expectedVersion: number, patch: { title?: string; content?: string; editSummary?: string }) {
  const artifact = getArtifact(userId, id);
  if (!artifact) return null;
  if (artifact.currentVersion !== expectedVersion) throw new Error("VERSION_CONFLICT");
  if (!patch.title && patch.content === undefined) return artifact;
  const content = patch.content ?? artifact.version?.contentMarkdown ?? String(artifact.version?.contentJson ?? "");
  const sanitized = artifact.type === "MARKDOWN" ? sanitizeMarkdown(String(content)) : sanitizeEChartsOption(parseJson<Record<string, unknown>>(String(content), {}));
  if (!sanitized.valid) throw new Error(sanitized.errors.join("; "));
  const now = isoNow();
  const db = getDatabase();
  const nextVersion = expectedVersion + 1;
  const safeContent = sanitized.sanitized;
  const contentJson = artifact.type === "MARKDOWN" ? null : JSON.stringify(safeContent);
  const contentMarkdown = artifact.type === "MARKDOWN" ? String(safeContent) : null;
  const serializedContent = contentJson ?? contentMarkdown ?? "";
  const update = db.transaction(() => {
    const result = db.prepare("UPDATE generated_artifacts SET title = COALESCE(?, title), current_version_no = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND user_id = ? AND status = 'ready' AND current_version_no = ?")
      .run(patch.title ?? null, nextVersion, now, id, userId, expectedVersion);
    if (!result.changes) throw new Error("VERSION_CONFLICT");
    db.prepare(`INSERT INTO generated_artifact_versions
      (id, artifact_id, version_no, content_type, content_json, content_markdown, content_sha256, size_bytes, created_by_type, created_by_id, edited_by, edit_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?)`)
      .run(createId("artifact_version"), id, nextVersion, artifact.type === "MARKDOWN" ? "markdown" : "echarts_option", contentJson, contentMarkdown,
        createHash("sha256").update(serializedContent).digest("hex"), Buffer.byteLength(serializedContent, "utf8"), userId, userId, patch.editSummary ?? null, now);
  });
  update();
  db.close();
  return getArtifact(userId, id);
}

export function deleteArtifact(userId: string, id: string, expectedVersion: number) {
  const db = getDatabase();
  const current = db.prepare("SELECT current_version_no, status FROM generated_artifacts WHERE id = ? AND user_id = ?").get(id, userId) as { current_version_no?: number; status?: string } | undefined;
  if (!current) { db.close(); return false; }
  if (current.status === "deleted") { db.close(); return true; }
  if (current.current_version_no !== expectedVersion) { db.close(); throw new Error("VERSION_CONFLICT"); }
  const now = isoNow();
  const result = db.prepare("UPDATE generated_artifacts SET status = 'deleted', deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND user_id = ? AND status != 'deleted' AND current_version_no = ?").run(now, now, id, userId, expectedVersion);
  db.close();
  if (!result.changes) throw new Error("VERSION_CONFLICT");
  return result.changes > 0;
}

function toArtifactSummary(row: ArtifactRow) {
  return { id: row.id, type: String(row.artifact_type).toUpperCase(), title: row.title, status: String(row.status).toUpperCase(), currentVersion: row.current_version_no, messageId: row.source_message_id, dataQueryId: row.source_query_id, analysisId: row.agent_run_id, previewUrl: `/api/v1/generated-artifacts/${row.id}/preview`, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toVersion(row: ArtifactRow) {
  return { version: row.version_no, contentJson: row.content_json, contentMarkdown: row.content_markdown, editNote: row.edit_note, createdAt: row.created_at };
}

function createMarkdownReport(title: string, rows: Record<string, unknown>[], columns: Array<{ name?: string }>) {
  const names = columns.length ? columns.map((column) => column.name ?? "value") : Object.keys(rows[0] ?? {});
  const header = `| ${names.join(" | ")} |\n| ${names.map(() => "---").join(" | ")} |`;
  const body = rows.slice(0, 500).map((row) => `| ${names.map((name) => String(row[name] ?? "").replaceAll("|", "\\|")).join(" | ")} |`).join("\n");
  return `# ${title}\n\n生成时间：${isoNow()}\n\n${header}${body ? `\n${body}` : "\n\n暂无数据。"}\n`;
}

function createChartOption(title: string, rows: Record<string, unknown>[], columns: Array<{ name?: string; type?: string }>) {
  const names = columns.length ? columns.map((column) => column.name ?? "value") : Object.keys(rows[0] ?? {});
  const category = names[0] ?? "category";
  const numeric = names.slice(1).filter((name) => rows.some((row) => typeof row[name] === "number" || !Number.isNaN(Number(row[name]))));
  return { title: { text: title }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: rows.map((row) => String(row[category] ?? "")) }, yAxis: { type: "value" }, series: numeric.slice(0, 5).map((name) => ({ name, type: "bar", data: rows.map((row) => Number(row[name] ?? 0)) })) };
}

function markdownToHtml(markdown: string): string {
  return markdown.split("\n").map((line) => {
    const escaped = line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    if (escaped.startsWith("# ")) return `<h1>${escaped.slice(2)}</h1>`;
    if (escaped.startsWith("## ")) return `<h2>${escaped.slice(3)}</h2>`;
    if (escaped.startsWith("| ")) return `<p>${escaped}</p>`;
    return escaped ? `<p>${escaped}</p>` : "";
  }).join("");
}
