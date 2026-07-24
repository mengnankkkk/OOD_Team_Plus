import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { formatRecommendation } from "@/server/extensions/advisor/recommendations";
import { createId, getDatabase, getRequestContext, isoNow, json, meta } from "@/server/http/context";

const ActionSchema = z.enum(["WATCH", "TRIAL_BUY", "SCALE_IN", "HOLD", "STOP_ADDING", "SCALE_OUT", "EXIT", "OBSERVE", "TRY", "ADD", "REDUCE"]);
const Schema = z.object({
  instrumentId: z.string().optional(),
  action: ActionSchema,
  suitability: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  summary: z.string().max(500).optional(),
  confidence: z.string().optional(),
  positionRange: z.array(z.string()).min(1).max(2),
  firstPosition: z.string().optional(),
  addConditions: z.array(z.string()).default([]),
  referenceRange: z.array(z.string()).optional(),
  stopLoss: z.string().optional(),
  takeProfit: z.string().optional(),
  horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).optional(),
  expiresAt: z.string().optional(),
  reasons: z.array(z.string()).max(3).default([]),
  counterEvidence: z.array(z.string()).min(1).default(["市场环境和估值可能快速变化。"]),
  risks: z.array(z.string()).max(3).default([]),
  alternatives: z.array(z.string()).default([]),
  invalidation: z.string().optional(),
  compliance: z.record(z.string(), z.unknown()).default({}),
  dataAsOf: z.string().optional(),
  provenance: z.record(z.string(), z.unknown()).default({}),
  conversationId: z.string().optional(),
  analysisId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid recommendation", details: parsed.error.format() } }, { status: 422 });
  const { userId } = getRequestContext(req);
  const now = isoNow();
  const id = createId("recommendation");
  const db = getDatabase();
  const action = canonicalAction(parsed.data.action);
  db.prepare(`INSERT INTO recommendations
    (id,user_id,conversation_id,analysis_id,instrument_id,action,suitability,summary,confidence_decimal,position_range_json,first_position,add_conditions_json,reference_range_json,stop_loss,take_profit,horizon,expires_at,reasons_json,counter_evidence_json,risks_json,alternatives_json,invalidation,compliance_json,data_as_of,provenance_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, userId, parsed.data.conversationId ?? null, parsed.data.analysisId ?? null, parsed.data.instrumentId ?? null, action, parsed.data.suitability,
    parsed.data.summary ?? null, parsed.data.confidence ?? null, json(parsed.data.positionRange), parsed.data.firstPosition ?? null, json(parsed.data.addConditions),
    parsed.data.referenceRange ? json(parsed.data.referenceRange) : null, parsed.data.stopLoss ?? null, parsed.data.takeProfit ?? null, parsed.data.horizon ?? null,
    parsed.data.expiresAt ?? null, json(parsed.data.reasons), json(parsed.data.counterEvidence), json(parsed.data.risks), json(parsed.data.alternatives),
    parsed.data.invalidation ?? null, json(parsed.data.compliance), parsed.data.dataAsOf ?? null, json(parsed.data.provenance), now, now,
  );
  const row = db.prepare("SELECT * FROM recommendations WHERE id=? AND user_id=?").get(id, userId) as Record<string, unknown>;
  db.close();
  return NextResponse.json({ data: formatRecommendation(row), meta: meta() }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const db = getDatabase();
  const rows = db.prepare("SELECT * FROM recommendations WHERE user_id=? AND status!='deleted' ORDER BY created_at DESC LIMIT ?").all(getRequestContext(req).userId, Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 100)) as Array<Record<string, unknown>>;
  db.close();
  return NextResponse.json({ data: { items: rows.map(formatRecommendation) }, meta: meta() });
}

function canonicalAction(action: z.infer<typeof ActionSchema>) {
  const legacy = { OBSERVE: "WATCH", TRY: "TRIAL_BUY", ADD: "SCALE_IN", REDUCE: "SCALE_OUT" } as const;
  return action in legacy ? legacy[action as keyof typeof legacy] : action;
}
