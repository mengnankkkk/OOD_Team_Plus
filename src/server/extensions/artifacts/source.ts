import { createHash } from "node:crypto";

import { getDatabase, parseJson } from "@/server/http/context";

export interface ArtifactSourceInput {
  userId: string;
  sourceMessageId?: string;
  sourceQueryId?: string;
  sessionId?: string;
  sourceRows?: Record<string, unknown>[];
  sourceColumns?: Array<{ name: string; type?: string }>;
}

export class ArtifactSourceError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number, message: string) {
    super(message);
  }
}

export function resolveArtifactSource(input: ArtifactSourceInput) {
  const db = getDatabase();
  try {
    const message = input.sourceMessageId ? db.prepare(`SELECT m.id,m.session_id,m.role,m.content,m.created_at
      FROM messages m JOIN conversation_sessions c ON c.id=m.session_id
      WHERE m.id=? AND c.user_id=?`).get(input.sourceMessageId, input.userId) as Record<string, unknown> | undefined : undefined;
    if (input.sourceMessageId && !message) throw new ArtifactSourceError("RESOURCE_NOT_FOUND", 404, "Source message not found");

    const query = input.sourceQueryId ? db.prepare("SELECT * FROM data_queries WHERE id=? AND user_id=?").get(input.sourceQueryId, input.userId) as Record<string, unknown> | undefined : undefined;
    if (input.sourceQueryId && !query) throw new ArtifactSourceError("RESOURCE_NOT_FOUND", 404, "Source query not found");
    if (query && query.status !== "succeeded") throw new ArtifactSourceError("QUERY_RESULT_NOT_READY", 409, "Query result is not ready");
    if (query?.result_expires_at && Date.parse(String(query.result_expires_at)) <= Date.now()) throw new ArtifactSourceError("QUERY_RESULT_EXPIRED", 410, "Query result has expired");

    const sessionId = String(message?.session_id ?? query?.session_id ?? input.sessionId ?? "") || null;
    for (const candidate of [input.sessionId, message?.session_id, query?.session_id]) {
      if (candidate && sessionId !== candidate) throw new ArtifactSourceError("SOURCE_CONTEXT_MISMATCH", 422, "Artifact sources must belong to the same conversation");
    }

    const history = sessionId ? db.prepare(`SELECT role,content,created_at FROM messages
      WHERE session_id=? ORDER BY created_at DESC LIMIT 20`).all(sessionId).reverse().map((row) => {
      const item = row as Record<string, unknown>;
      return { role: item.role, content: String(item.content ?? "").slice(0, 2000), createdAt: item.created_at };
    }) : [];
    const chunks = query ? db.prepare("SELECT rows_json FROM data_query_result_chunks WHERE query_id=? ORDER BY chunk_no").all(query.id) as Array<{ rows_json: string }> : [];
    let rows = query ? chunks.flatMap((chunk) => parseJson<Record<string, unknown>[]>(chunk.rows_json, [])) : input.sourceRows ?? [];
    let columns = query ? parseJson<Array<{ name: string; type?: string }>>(String(query.column_metadata_json ?? "[]"), []) : input.sourceColumns ?? [];
    if (!rows.length && !input.sourceRows) {
      rows = loadCurrentPortfolioRows(db, input.userId);
      columns = [{ name: "symbol", type: "string" }, { name: "marketValue", type: "number" }, { name: "unrealizedPnl", type: "number" }, { name: "weightPercent", type: "number" }];
    }
    const snapshot = {
      sourceMessage: message ? { id: message.id, role: message.role, content: String(message.content ?? "").slice(0, 8000), createdAt: message.created_at } : null,
      conversationHistory: history,
      query: query ? { id: query.id, question: query.question_text, rowCount: query.row_count, columns, dataAsOf: query.data_as_of } : null,
      rowCount: rows.length,
      dataAsOf: query?.data_as_of ?? new Date().toISOString(),
    };
    const snapshotJson = JSON.stringify(snapshot);
    if (Buffer.byteLength(snapshotJson, "utf8") > 100 * 1024) throw new ArtifactSourceError("SOURCE_SNAPSHOT_TOO_LARGE", 422, "Artifact source snapshot exceeds 100 KiB");
    return { sessionId, sourceMessageRole: message?.role ? String(message.role) : null, rows, columns, snapshot, snapshotJson, snapshotSha256: createHash("sha256").update(snapshotJson).digest("hex") };
  } finally {
    db.close();
  }
}

function loadCurrentPortfolioRows(db: ReturnType<typeof getDatabase>, userId: string): Record<string, unknown>[] {
  return db.prepare(`SELECT i.symbol,CAST(h.market_value_decimal AS REAL) AS marketValue,
      CAST(h.unrealized_pnl_decimal AS REAL) AS unrealizedPnl,h.weight_bps / 100.0 AS weightPercent
    FROM holding_snapshots h JOIN instruments i ON i.id=h.instrument_id
    WHERE h.portfolio_snapshot_id=(SELECT id FROM portfolio_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT 1)
    ORDER BY h.weight_bps DESC`).all(userId) as Record<string, unknown>[];
}
