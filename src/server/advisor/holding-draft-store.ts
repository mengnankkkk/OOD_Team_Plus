import type { AdvisorDatabase } from "@/server/advisor/database";
import { json, newId, nowIso, parseJson, runValue, runWrite } from "@/server/advisor/store-common";

export type HoldingDraft = {
  id: string;
  status: "NEEDS_CONFIRMATION" | "CONFIRMED" | "REJECTED" | "EXPIRED";
  sourceText: string;
  candidates: Array<Record<string, unknown>>;
  ambiguities: string[];
  expiresAt: string;
};

type CreateHolding = (userId: string, input: Record<string, unknown>, sourceType: string) => unknown;

export class HoldingDraftStore {
  constructor(
    private readonly database: AdvisorDatabase,
    private readonly createHolding: CreateHolding,
  ) {}

  create(userId: string, sessionId: string | null, sourceText: string, candidates: Array<Record<string, unknown>>, ambiguities: string[]) {
    const id = newId("parse");
    const timestamp = nowIso();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    runWrite(
      this.database,
      `INSERT INTO holding_parse_drafts
       (id, user_id, session_id, source_text, status, candidates_json, ambiguities_json, expires_at, row_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending_confirmation', ?, ?, ?, 1, ?, ?)`,
      id,
      userId,
      sessionId,
      sourceText,
      json(candidates),
      json(ambiguities),
      expiresAt,
      timestamp,
      timestamp,
    );
    return { id, status: "NEEDS_CONFIRMATION", sourceText, candidates, ambiguities, expiresAt };
  }

  get(userId: string, draftId: string): HoldingDraft | null {
    const row = runValue<Record<string, unknown>>(
      this.database,
      "SELECT * FROM holding_parse_drafts WHERE id = ? AND user_id = ?",
      draftId,
      userId,
    );
    if (!row) return null;
    const rawStatus = String(row.status);
    if (new Date(String(row.expires_at)).getTime() < Date.now() && rawStatus === "pending_confirmation") {
      runWrite(this.database, "UPDATE holding_parse_drafts SET status = 'expired', updated_at = ? WHERE id = ?", nowIso(), draftId);
      return { id: draftId, status: "EXPIRED", sourceText: String(row.source_text), candidates: [], ambiguities: [], expiresAt: String(row.expires_at) };
    }
    return {
      id: String(row.id),
      status: publicStatus(rawStatus),
      sourceText: String(row.source_text),
      candidates: parseJson(row.candidates_json, []),
      ambiguities: parseJson(row.ambiguities_json, []),
      expiresAt: String(row.expires_at),
    };
  }

  confirm(userId: string, draftId: string, confirmedCandidates: Array<Record<string, unknown>>, idempotencyKey?: string) {
    const draft = this.get(userId, draftId);
    if (!draft) throw new Error("RESOURCE_NOT_FOUND");
    if (draft.status !== "NEEDS_CONFIRMATION") throw new Error("PARSE_ALREADY_CONFIRMED");
    if (confirmedCandidates.length === 0) throw new Error("HOLDING_CONFIRMATION_REQUIRED");
    for (const candidate of confirmedCandidates) {
      const sourceCandidate = draft.candidates.find((item) => item.candidateId === candidate.candidateId);
      if (!sourceCandidate) throw new Error("HOLDING_CANDIDATE_NOT_FOUND");
      const sourceIssues = Array.isArray(sourceCandidate.issues)
        ? sourceCandidate.issues.filter((issue): issue is Record<string, unknown> => Boolean(issue && typeof issue === "object"))
        : [];
      const isIndexMapping = sourceIssues.some((issue) => String(issue.code) === "DIRECT_INDEX_NOT_TRADABLE");
      if (!candidate.instrumentId) {
        if (isIndexMapping) throw new Error("INDEX_HOLDING_MAPPING_REQUIRED");
        throw new Error("HOLDING_INSTRUMENT_REQUIRED");
      }
      if (isIndexMapping && String(candidate.averageCost) === String(sourceCandidate.averageCost)) {
        throw new Error("INDEX_PRICE_REENTRY_REQUIRED");
      }
    }
    const holdings = confirmedCandidates.map((candidate) => this.createHolding(userId, candidate, "conversation"));
    runWrite(
      this.database,
      `UPDATE holding_parse_drafts SET status = 'confirmed', confirmed_holding_ids_json = ?, updated_at = ? WHERE id = ?`,
      json((holdings as Array<{ id: string }>).map((holding) => holding.id)),
      nowIso(),
      draftId,
    );
    return { parseId: draftId, status: "CONFIRMED", holdings, idempotencyKey };
  }
}

function publicStatus(status: string): HoldingDraft["status"] {
  switch (status) {
    case "pending_confirmation":
      return "NEEDS_CONFIRMATION";
    case "confirmed":
      return "CONFIRMED";
    case "rejected":
      return "REJECTED";
    case "expired":
      return "EXPIRED";
    default:
      return "EXPIRED";
  }
}
