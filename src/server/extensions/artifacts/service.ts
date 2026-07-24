import { createHash } from "node:crypto";

import { getDatabase, createId, isoNow, json, meta, parseJson } from "@/server/http/context";
import { sanitizeEChartsOption } from "@/server/extensions/sanitizers/echarts-sanitizer";
import { sanitizeMarkdown } from "@/server/extensions/sanitizers/markdown-sanitizer";
import { getDataQuery } from "@/server/extensions/query/service";
import { persistSseEvent } from "@/server/extensions/sse/event-persister";

export type ArtifactType = "ECHARTS_OPTION" | "MARKDOWN";

type ArtifactInput = {
  userId: string;
  artifactType: ArtifactType;
  title: string;
  sourceMessageId?: string;
  sourceQueryId?: string;
  sessionId?: string;
};

type ArtifactRow = Record<string, unknown>;

export function createArtifact(input: ArtifactInput) {
  const query = input.sourceQueryId ? getDataQuery(input.userId, input.sourceQueryId) : null;
  if (input.sourceQueryId && (!query || query.status !== "succeeded")) {
    throw new Error("Query result is not ready");
  }

  const rows = query?.rows ?? [];
  const columns = query?.columns ?? [];
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
  const sourceSnapshot = { sourceMessageId: input.sourceMessageId ?? null, sourceQueryId: input.sourceQueryId ?? null, rowCount: rows.length, dataAsOf: query?.data_as_of ?? now };
  const sourceSnapshotJson = json(sourceSnapshot);
  const sourceHash = createHash("sha256").update(sourceSnapshotJson).digest("hex");
  const contentJson = input.artifactType === "ECHARTS_OPTION" ? JSON.stringify(sanitized.sanitized) : null;
  const contentMarkdown = input.artifactType === "MARKDOWN" ? String(sanitized.sanitized) : null;
  const db = getDatabase();
  db.prepare("INSERT INTO agent_runs (id, user_id, type, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)").run(analysisId, input.userId, "artifact_generation", "completed", now, now);
  db.prepare(`INSERT INTO generated_artifacts
    (id, user_id, session_id, source_message_id, source_query_id, agent_run_id, artifact_type, status,
     title, current_version_no, source_snapshot_json, source_snapshot_sha256, provenance_json,
     ready_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, 1, ?, ?, ?, ?, ?, ?)`)
    .run(artifactId, input.userId, input.sessionId ?? null, input.sourceMessageId ?? null, input.sourceQueryId ?? null,
      analysisId, input.artifactType === "ECHARTS_OPTION" ? "echarts_option" : "markdown", input.title,
      sourceSnapshotJson, sourceHash, json({ analysisId, modelName: "local-deterministic", algorithmVersion: "artifact-v1" }), now, now, now);
  db.prepare(`INSERT INTO generated_artifact_versions
    (id, artifact_id, version_no, content_type, content_json, content_markdown, edited_by, created_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(createId("artifact_version"), artifactId, input.artifactType === "ECHARTS_OPTION" ? "echarts_option" : "markdown", contentJson, contentMarkdown, input.userId, now);
  db.close();
  void persistSseEvent({ analysisId, type: "artifact.completed", payload: { artifactId, type: input.artifactType } });
  return { artifactId, analysisId, status: "READY", version: 1 };
}

export function listArtifacts(userId: string, limit: number, filters: { sourceMessageId?: string; artifactType?: string; status?: string } = {}) {
  const db = getDatabase();
  const conditions = ["user_id = ?", "status != 'deleted'"];
  const params: unknown[] = [userId];
  if (filters.sourceMessageId) { conditions.push("source_message_id = ?"); params.push(filters.sourceMessageId); }
  if (filters.artifactType) { conditions.push("artifact_type = ?"); params.push(filters.artifactType.toLowerCase()); }
  if (filters.status) { conditions.push("status = ?"); params.push(filters.status.toLowerCase()); }
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
  db.prepare("INSERT INTO generated_artifact_versions (id, artifact_id, version_no, content_type, content_json, content_markdown, edited_by, edit_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(createId("artifact_version"), id, nextVersion, artifact.type === "MARKDOWN" ? "markdown" : "echarts_option", artifact.type === "MARKDOWN" ? null : JSON.stringify(safeContent), artifact.type === "MARKDOWN" ? String(safeContent) : null, userId, patch.editSummary ?? null, now);
  db.prepare("UPDATE generated_artifacts SET title = COALESCE(?, title), current_version_no = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND user_id = ?")
    .run(patch.title ?? null, nextVersion, now, id, userId);
  db.close();
  return getArtifact(userId, id);
}

export function deleteArtifact(userId: string, id: string) {
  const db = getDatabase();
  const result = db.prepare("UPDATE generated_artifacts SET status = 'deleted', deleted_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND user_id = ? AND status != 'deleted'").run(isoNow(), isoNow(), id, userId);
  db.close();
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
