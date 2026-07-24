import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { formatRecommendation } from "@/server/extensions/advisor/recommendations";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { createId, getDatabase, getRequestContext, idempotencyKey, isoNow, json, meta } from "@/server/http/context";

const Schema = z.object({ action: z.enum(["ACCEPT", "REJECT", "DEFER"]), reason: z.string().max(1000).optional(), note: z.string().max(1000).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid decision", details: parsed.error.format() } }, { status: 422 });
  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  const routeCode = `recommendation_decision:${id}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const db = getDatabase();
  const recommendation = db.prepare("SELECT * FROM recommendations WHERE id=? AND user_id=? AND status!='deleted'").get(id, userId) as Record<string, unknown> | undefined;
  if (!recommendation) {
    db.close();
    return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Recommendation not found" } }, { status: 404 });
  }
  if (recommendation.expires_at && Date.parse(String(recommendation.expires_at)) <= Date.now()) {
    db.close();
    return NextResponse.json({ error: { code: "DECISION_CONFLICT", message: "Recommendation has expired" } }, { status: 409 });
  }
  const decisionId = createId("decision");
  const now = isoNow();
  db.prepare("INSERT INTO decision_logs (id,user_id,conversation_id,action,recommendation_json,decision,created_at) VALUES (?,?,?,?,?,?,?)").run(decisionId, userId, recommendation.conversation_id ?? null, parsed.data.action, json({ recommendation: formatRecommendation(recommendation), reason: parsed.data.reason ?? null, note: parsed.data.note ?? null }), parsed.data.action, now);
  db.close();
  const payload = { data: { decisionId, recommendationId: id, action: parsed.data.action, ordersCreated: false, createdAt: now }, meta: meta() };
  await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
  return NextResponse.json(payload, { status: 201 });
}
