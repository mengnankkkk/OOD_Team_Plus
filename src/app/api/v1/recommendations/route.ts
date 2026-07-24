import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createId, getDatabase, getRequestContext, isoNow, meta, json, parseJson } from "@/server/http/context";

const Schema = z.object({
  action: z.enum(["OBSERVE", "TRY", "ADD", "HOLD", "STOP_ADDING", "REDUCE", "EXIT"]),
  suitability: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  positionRange: z.array(z.string()).min(1).max(2),
  firstPosition: z.string().optional(),
  addConditions: z.array(z.string()).default([]),
  referenceRange: z.array(z.string()).optional(),
  stopLoss: z.string().optional(),
  takeProfit: z.string().optional(),
  horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).optional(),
  expiresAt: z.string().optional(),
  reasons: z.array(z.string()).max(3).default([]),
  counterEvidence: z.array(z.string()).min(1).default(["市场环境和估值可能快速变化"]),
  risks: z.array(z.string()).max(3).default([]),
  alternatives: z.array(z.string()).default([]),
  invalidation: z.string().optional(),
  conversationId: z.string().optional(),
  analysisId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid recommendation", details: parsed.error.format() } }, { status: 422 });
  const { userId } = getRequestContext(req); const now = isoNow(); const id = createId("recommendation"); const db = getDatabase();
  db.prepare(`INSERT INTO recommendations (id,user_id,conversation_id,analysis_id,action,suitability,position_range_json,first_position,add_conditions_json,reference_range_json,stop_loss,take_profit,horizon,expires_at,reasons_json,counter_evidence_json,risks_json,alternatives_json,invalidation,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, parsed.data.conversationId ?? null, parsed.data.analysisId ?? null, parsed.data.action, parsed.data.suitability, json(parsed.data.positionRange), parsed.data.firstPosition ?? null, json(parsed.data.addConditions), parsed.data.referenceRange ? json(parsed.data.referenceRange) : null, parsed.data.stopLoss ?? null, parsed.data.takeProfit ?? null, parsed.data.horizon ?? null, parsed.data.expiresAt ?? null, json(parsed.data.reasons), json(parsed.data.counterEvidence), json(parsed.data.risks), json(parsed.data.alternatives), parsed.data.invalidation ?? null, now, now);
  const row = db.prepare("SELECT * FROM recommendations WHERE id=?").get(id); db.close(); return NextResponse.json({ data: format(row as Record<string, unknown>), meta: meta() }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const db = getDatabase(); const rows = db.prepare("SELECT * FROM recommendations WHERE user_id=? AND status='active' ORDER BY created_at DESC LIMIT ?").all(getRequestContext(req).userId, Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 100)) as Array<Record<string, unknown>>; db.close(); return NextResponse.json({ data: { items: rows.map(format) }, meta: meta() });
}

function format(row: Record<string, unknown>) { return { id: row.id, action: row.action, suitability: row.suitability, positionRange: parseJson(row.position_range_json as string, []), firstPosition: row.first_position, addConditions: parseJson(row.add_conditions_json as string, []), referenceRange: parseJson(row.reference_range_json as string, null), stopLoss: row.stop_loss, takeProfit: row.take_profit, horizon: row.horizon, expiresAt: row.expires_at, reasons: parseJson(row.reasons_json as string, []), counterEvidence: parseJson(row.counter_evidence_json as string, []), risks: parseJson(row.risks_json as string, []), alternatives: parseJson(row.alternatives_json as string, []), invalidation: row.invalidation, createdAt: row.created_at, updatedAt: row.updated_at }; }
