import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { formatRecommendation } from "@/server/extensions/advisor/recommendations";
import { beginIdempotentRequest, parseIdempotentResponse, saveIdempotentResponse } from "@/server/extensions/middleware/idempotency";
import { createWorkspace } from "@/server/extensions/simulation/service";
import { getDatabase, getRequestContext, idempotencyKey, meta } from "@/server/http/context";

const Schema = z.object({ label: z.string().min(1).max(120).optional(), objective: z.string().min(1).max(2000).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!idempotencyKey(req)) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Idempotency-Key required" } }, { status: 400 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid simulation request", details: parsed.error.format() } }, { status: 422 });
  const { userId } = getRequestContext(req);
  const key = idempotencyKey(req)!;
  const routeCode = `recommendation_simulation:${id}`;
  const idem = await beginIdempotentRequest(userId, routeCode, key, parsed.data);
  if (idem.existing?.conflict) return NextResponse.json({ error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key was already used with a different request" } }, { status: 409 });
  if (idem.existing) return NextResponse.json(parseIdempotentResponse(idem.existing), { status: 200 });
  const db = getDatabase();
  const recommendation = db.prepare("SELECT * FROM recommendations WHERE id=? AND user_id=? AND status='active'").get(id, userId) as Record<string, unknown> | undefined;
  const snapshot = db.prepare("SELECT id FROM portfolio_snapshots WHERE user_id=? ORDER BY created_at DESC LIMIT 1").get(userId) as { id?: string } | undefined;
  db.close();
  if (!recommendation || !snapshot?.id) return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Recommendation or portfolio snapshot not found" } }, { status: 404 });
  const formatted = formatRecommendation(recommendation);
  const result = createWorkspace(userId, { label: parsed.data.label ?? `建议模拟：${formatted.summary ?? formatted.action}`, objectiveText: parsed.data.objective ?? `模拟采纳建议 ${formatted.action} 对组合的影响`, portfolioSnapshotId: snapshot.id, conversationSessionId: String(recommendation.conversation_id ?? "") || undefined, recommendationId: id });
  const payload = { data: { workspaceId: result.workspaceId, recommendationId: id, rootBranchId: result.branchId, activeBranchId: result.branchId, ordersCreated: false, next: { generateOptionsUrl: `/api/v1/simulation-workspaces/${result.workspaceId}/options` }, analysis: { analysisId: result.analysisId, type: "SIMULATION_WORKSPACE", status: "COMPLETED", streamUrl: `/api/v1/analyses/${result.analysisId}/events` } }, meta: meta() };
  await saveIdempotentResponse(userId, routeCode, key, idem.requestHash, payload);
  return NextResponse.json(payload, { status: 201 });
}
