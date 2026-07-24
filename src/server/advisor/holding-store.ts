import type { AdvisorDatabase } from "@/server/advisor/database";
import type { InstrumentRecord } from "@/server/advisor/profile-store";
import { HoldingDraftStore, type HoldingDraft } from "@/server/advisor/holding-draft-store";
import { newId, nowIso, parseJson, runRows, runValue, runWrite, transaction } from "@/server/advisor/store-common";

export type { HoldingDraft } from "@/server/advisor/holding-draft-store";

export type HoldingRecord = {
  id: string;
  accountId: string;
  instrumentId: string;
  instrument: InstrumentRecord;
  goalId: string | null;
  quantity: string;
  averageCost: string;
  currency: string;
  acquiredAt: string | null;
  purpose: string | null;
  plannedHorizon: string | null;
  thesis: string | null;
  version: number;
};

export class HoldingStore {
  readonly drafts: HoldingDraftStore;

  constructor(private readonly database: AdvisorDatabase) {
    this.drafts = new HoldingDraftStore(database, (userId, input, sourceType) => this.createHolding(userId, input, sourceType));
  }

  listHoldings(userId: string) {
    return runRows<Record<string, unknown>>(
      this.database,
      `SELECT h.*, i.symbol, i.name AS instrument_name, i.instrument_type, i.instrument_subtype,
       i.market, i.currency AS instrument_currency, i.sector_name, i.is_tradable, i.metadata_json
       FROM holdings h JOIN accounts a ON a.id = h.account_id
       JOIN instruments i ON i.id = h.instrument_id
       WHERE a.user_id = ? ORDER BY h.created_at`,
      userId,
    ).map(mapHolding);
  }

  getHolding(userId: string, holdingId: string) {
    return this.listHoldings(userId).find((holding) => holding.id === holdingId) ?? null;
  }

  getCashBalance(userId: string) {
    const row = runValue<{ cash_balance_minor: number }>(
      this.database,
      "SELECT COALESCE(SUM(cash_balance_minor), 0) AS cash_balance_minor FROM accounts WHERE user_id = ?",
      userId,
    );
    return Number(row?.cash_balance_minor ?? 0);
  }

  createHolding(userId: string, input: Record<string, unknown>, sourceType = "manual") {
    const accountId = this.ensureAccount(userId);
    const instrumentId = String(input.instrumentId);
    const instrument = runValue<{ is_tradable: number }>(
      this.database,
      "SELECT is_tradable FROM instruments WHERE id = ?",
      instrumentId,
    );
    if (!instrument) throw new Error("RESOURCE_NOT_FOUND");
    if (Number(instrument.is_tradable) !== 1) throw new Error("ASSET_NOT_TRADABLE");
    const existing = runValue<{ id: string }>(
      this.database,
      "SELECT id FROM holdings WHERE account_id = ? AND instrument_id = ?",
      accountId,
      instrumentId,
    );
    const id = existing?.id ?? newId("holding");
    const timestamp = nowIso();
    transaction(this.database, () => {
      if (existing) {
        runWrite(
          this.database,
          `UPDATE holdings SET quantity = ?, average_cost = ?, goal_id = ?, acquired_at = ?,
           purpose = ?, planned_horizon = ?, thesis = ?, version = version + 1, updated_at = ? WHERE id = ?`,
          input.quantity,
          input.averageCost,
          input.goalId ?? null,
          input.acquiredAt ?? null,
          input.purpose ?? null,
          input.plannedHorizon ?? null,
          input.thesis ?? null,
          timestamp,
          id,
        );
      } else {
        runWrite(
          this.database,
          `INSERT INTO holdings
           (id, account_id, instrument_id, goal_id, quantity, average_cost, currency, acquired_at,
            purpose, planned_horizon, thesis, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          id,
          accountId,
          instrumentId,
          input.goalId ?? null,
          input.quantity,
          input.averageCost,
          input.currency ?? "CNY",
          input.acquiredAt ?? null,
          input.purpose ?? null,
          input.plannedHorizon ?? null,
          input.thesis ?? null,
          timestamp,
          timestamp,
        );
      }
      runWrite(
        this.database,
        `INSERT INTO holding_lots(id, holding_id, acquired_at, quantity, unit_cost, source_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId("lot"),
        id,
        input.acquiredAt ?? null,
        input.quantity,
        input.averageCost,
        sourceType,
        timestamp,
      );
    });
    return this.getHolding(userId, id)!;
  }

  updateHolding(userId: string, holdingId: string, patch: Record<string, unknown>, expectedVersion?: number) {
    const current = this.getHolding(userId, holdingId);
    if (!current) return null;
    if (expectedVersion != null && current.version !== expectedVersion) throw new Error("VERSION_CONFLICT");
    runWrite(
      this.database,
      `UPDATE holdings SET quantity = COALESCE(?, quantity), average_cost = COALESCE(?, average_cost),
       thesis = COALESCE(?, thesis), version = version + 1, updated_at = ? WHERE id = ?`,
      patch.quantity ?? null,
      patch.averageCost ?? null,
      patch.thesis ?? null,
      nowIso(),
      holdingId,
    );
    return this.getHolding(userId, holdingId);
  }

  deleteHolding(userId: string, holdingId: string) {
    const current = this.getHolding(userId, holdingId);
    if (!current) return false;
    runWrite(this.database, "DELETE FROM holdings WHERE id = ?", holdingId);
    return true;
  }

  createDraft(userId: string, sessionId: string | null, sourceText: string, candidates: Array<Record<string, unknown>>, ambiguities: string[]) {
    return this.drafts.create(userId, sessionId, sourceText, candidates, ambiguities);
  }

  getDraft(userId: string, draftId: string): HoldingDraft | null {
    return this.drafts.get(userId, draftId);
  }

  confirmDraft(userId: string, draftId: string, confirmedCandidates: Array<Record<string, unknown>>, idempotencyKey?: string) {
    return this.drafts.confirm(userId, draftId, confirmedCandidates, idempotencyKey);
  }

  ensureAccount(userId: string) {
    const existing = runValue<{ id: string }>(
      this.database,
      "SELECT id FROM accounts WHERE user_id = ? ORDER BY created_at LIMIT 1",
      userId,
    );
    if (existing) return existing.id;
    const id = newId("account");
    const timestamp = nowIso();
    runWrite(
      this.database,
      `INSERT INTO accounts(id, user_id, name, account_type, currency, cash_balance_minor, source_type, is_demo, created_at, updated_at)
       VALUES (?, ?, '演示账户', 'demo', 'CNY', 0, 'manual', 1, ?, ?)`,
      id,
      userId,
      timestamp,
      timestamp,
    );
    return id;
  }
}

function mapHolding(row: Record<string, unknown>): HoldingRecord {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    instrumentId: String(row.instrument_id),
    instrument: {
      id: String(row.instrument_id),
      symbol: String(row.symbol),
      name: String(row.instrument_name),
      market: String(row.market).toUpperCase(),
      assetType: assetType(row.instrument_type, row.instrument_subtype),
      instrumentSubtype: row.instrument_subtype ? String(row.instrument_subtype).toUpperCase() : null,
      currency: String(row.instrument_currency),
      sectorName: row.sector_name as string | null,
      tradable: Number(row.is_tradable) === 1,
      metadata: parseJson(row.metadata_json, {}),
    },
    goalId: row.goal_id as string | null,
    quantity: String(row.quantity),
    averageCost: String(row.average_cost),
    currency: String(row.currency),
    acquiredAt: row.acquired_at as string | null,
    purpose: row.purpose as string | null,
    plannedHorizon: row.planned_horizon as string | null,
    thesis: row.thesis as string | null,
    version: Number(row.version),
  };
}

function assetType(type: unknown, subtype: unknown) {
  const normalizedType = String(type).toUpperCase();
  const normalizedSubtype = subtype == null ? "" : String(subtype).toUpperCase();
  if (normalizedSubtype === "GOLD_ETF") return "GOLD_ETF";
  if (normalizedSubtype === "INDEX_FUND") return "INDEX_FUND";
  if (normalizedType === "FUND") return "INDEX_FUND";
  return normalizedType;
}
