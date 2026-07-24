import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { syncPortfolioFromHoldings } from "@/server/extensions/analysis/service";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { createId, getDatabase, getRequestContext, idempotencyKey, isoNow, json, meta, parseJson } from "@/server/http/context";

const Decimal = z.string().trim().regex(/^\d+(?:\.\d+)?$/u);
const CandidateSchema = z.object({
  candidateId: z.string().optional(),
  instrumentId: z.string().min(1).optional(),
  symbol: z.string().trim().min(1).optional(),
  quantity: Decimal.refine((value) => Number(value) > 0),
  averageCost: Decimal.optional(),
  cost: Decimal.optional(),
  portfolioId: z.string().trim().min(1).optional(),
}).superRefine((value, context) => {
  if (!value.instrumentId && !value.symbol) context.addIssue({ code: z.ZodIssueCode.custom, path: ["symbol"], message: "instrumentId or symbol is required" });
  if (value.averageCost === undefined && value.cost === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["averageCost"], message: "averageCost is required" });
});
const Schema = z.object({ confirmedCandidates: z.array(CandidateSchema).min(1).optional(), candidates: z.array(CandidateSchema).min(1).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ parseId: string }> }) {
  const { parseId } = await params;
  const rawBody = await req.json().catch(() => ({}));
  const key = idempotencyKey(req);
  if (!key) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const userId = getRequestContext(req).userId;
  const routeCode = `holding_parse_confirm:${parseId}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, rawBody);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const db = getDatabase();
  const parse = db.prepare("SELECT * FROM holding_parses WHERE id=? AND user_id=? AND status='pending'").get(parseId, userId) as Record<string, unknown> | undefined;
  if (!parse) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Holding parse not found" } }, { status: 404 }); }
  const requestCandidates = rawBody && typeof rawBody === "object" && ("confirmedCandidates" in rawBody || "candidates" in rawBody)
    ? rawBody
    : { candidates: parseJson(parse.candidates_json as string, []) };
  const parsed = Schema.safeParse(requestCandidates);
  const candidates = parsed.success ? parsed.data.confirmedCandidates ?? parsed.data.candidates : null;
  if (!parsed.success || !candidates?.length) { db.close(); return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid holding candidates", details: parsed.success ? undefined : parsed.error.format() } }, { status: 422 }); }
  const resolved: Array<{ instrumentId: string; symbol: string; quantity: string; cost: string; portfolioId: string }> = [];
  for (const candidate of candidates) {
    const instrument = (candidate.instrumentId
      ? db.prepare("SELECT id,symbol FROM instruments WHERE id=? AND tradable=1").get(candidate.instrumentId)
      : db.prepare("SELECT id,symbol FROM instruments WHERE UPPER(symbol)=UPPER(?) AND tradable=1").get(candidate.symbol)) as { id?: string; symbol?: string } | undefined;
    if (!instrument?.id || !instrument.symbol) { db.close(); return NextResponse.json({ error: { code: "ASSET_NOT_TRADABLE", message: "Tradable instrument not found" } }, { status: 422 }); }
    const portfolioId = candidate.portfolioId ?? "portfolio-demo";
    if (resolved.some((item) => item.instrumentId === instrument.id && item.portfolioId === portfolioId)) { db.close(); return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Duplicate holding candidate" } }, { status: 422 }); }
    const existing = db.prepare("SELECT id FROM holdings WHERE user_id=? AND portfolio_id=? AND instrument_id=? AND status='active'").get(userId, portfolioId, instrument.id);
    if (existing) { db.close(); return NextResponse.json({ error: { code: "HOLDING_ALREADY_EXISTS", message: "Holding already exists" } }, { status: 409 }); }
    resolved.push({ instrumentId: instrument.id, symbol: instrument.symbol, quantity: candidate.quantity, cost: candidate.averageCost ?? candidate.cost!, portfolioId });
  }
  const now = isoNow();
  const holdingIds: string[] = [];
  const publish = db.transaction(() => {
    for (const candidate of resolved) {
      const id = createId("holding");
      holdingIds.push(id);
      db.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, userId, candidate.portfolioId, candidate.instrumentId, candidate.quantity, candidate.cost, now, now);
    }
    db.prepare("UPDATE holding_parses SET status='confirmed',confirmed_holding_ids_json=?,confirmed_at=?,row_version=row_version+1 WHERE id=? AND user_id=? AND status='pending'").run(json(holdingIds), now, parseId, userId);
  });
  publish();
  const holdings = db.prepare(`SELECT h.*,i.symbol,i.name,i.asset_type FROM holdings h JOIN instruments i ON i.id=h.instrument_id
    WHERE h.id IN (${holdingIds.map(() => "?").join(",")}) ORDER BY h.created_at,h.id`).all(...holdingIds) as Array<Record<string, unknown>>;
  db.close();
  for (const portfolioId of new Set(resolved.map((candidate) => candidate.portfolioId))) syncPortfolioFromHoldings(userId, portfolioId);
  const payload = { data: { parseId, status: "CONFIRMED", holdingIds, holdings: holdings.map((holding) => ({ ...holding, averageCost: holding.cost_decimal, version: holding.version ?? 1 })) }, meta: meta() };
  await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
  return NextResponse.json(payload, { status: 201 });
}
