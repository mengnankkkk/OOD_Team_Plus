import { NextRequest, NextResponse } from "next/server";

import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function POST(req: NextRequest, { params }: { params: Promise<{ parseId: string }> }) {
  const { parseId } = await params; const body = await req.json().catch(() => null) as { candidates?: Array<{ instrumentId: string; quantity: string; cost: string }> } | null;
  const db = getDatabase(); const userId = getRequestContext(req).userId;
  const parse = db.prepare("SELECT * FROM holding_parses WHERE id=? AND user_id=? AND status='pending'").get(parseId, userId) as Record<string, unknown> | undefined;
  if (!parse) { db.close(); return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Holding parse not found" } }, { status: 404 }); }
  const candidates = body?.candidates ?? JSON.parse(String(parse.candidates_json)) as Array<{ instrumentId: string; quantity: string; cost: string }>;
  const now = isoNow(); const holdingIds: string[] = [];
  for (const candidate of candidates) { const id = createId("holding"); holdingIds.push(id); db.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, userId, "portfolio-demo", candidate.instrumentId, candidate.quantity, candidate.cost, now, now); }
  db.prepare("UPDATE holding_parses SET status='confirmed',confirmed_at=? WHERE id=?").run(now, parseId); db.close();
  return NextResponse.json({ data: { parseId, status: "CONFIRMED", holdingIds }, meta: meta() }, { status: 201 });
}
