import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createId, getDatabase, getRequestContext, idempotencyKey, isoNow, meta } from "@/server/http/context";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";

const Schema = z.object({
  holdingId: z.string().optional(),
  instrumentId: z.string().optional(),
  conditionType: z.enum(["UNREALIZED_GAIN_REACH", "PRICE_ABOVE", "PRICE_BELOW", "DRAWDOWN_REACH"]),
  threshold: z.string().min(1),
  sourceRecommendationId: z.string().optional(),
}).refine((value) => Boolean(value.holdingId || value.instrumentId), { message: "holdingId or instrumentId is required" });

export async function GET(req: NextRequest) {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM observation_conditions WHERE user_id = ? ORDER BY created_at DESC").all(getRequestContext(req).userId);
  db.close();
  return NextResponse.json({ data: { items: rows }, meta: meta() });
}

export async function POST(req: NextRequest) {
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid observation condition", details: parsed.error.format() } }, { status: 422 });
  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  const idem = await beginIdempotentRequest(userId, "observation_condition", key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const db = getDatabase();
  if (parsed.data.holdingId && !db.prepare("SELECT id FROM holdings WHERE id=? AND user_id=? AND status='active'").get(parsed.data.holdingId, userId)) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Holding not found" } }, { status: 404 }); }
  if (parsed.data.instrumentId && !db.prepare("SELECT id FROM instruments WHERE id=?").get(parsed.data.instrumentId)) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Instrument not found" } }, { status: 404 }); }
  if (parsed.data.sourceRecommendationId && !db.prepare("SELECT id FROM recommendations WHERE id=? AND user_id=?").get(parsed.data.sourceRecommendationId, userId)) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Recommendation not found" } }, { status: 404 }); }
  const now = isoNow();
  const id = createId("condition");
  const result = db.prepare(`INSERT INTO observation_conditions
    (id, user_id, holding_id, instrument_id, condition_type, threshold_decimal, source_recommendation_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, parsed.data.holdingId ?? null, parsed.data.instrumentId ?? null, parsed.data.conditionType, parsed.data.threshold, parsed.data.sourceRecommendationId ?? null, now, now);
  void result;
  const row = db.prepare("SELECT * FROM observation_conditions WHERE id = ?").get(id);
  db.close();
  const payload = { data: row, meta: meta() };
  await saveIdempotentResponse(userId, "observation_condition", key, idem.requestHash, payload);
  return NextResponse.json(payload, { status: 201 });
}
