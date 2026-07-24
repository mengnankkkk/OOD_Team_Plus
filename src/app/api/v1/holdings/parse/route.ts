import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

const Schema = z.object({ text: z.string().min(1).max(2000) });

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "text is required" } }, { status: 422 });
  const db = getDatabase(); const candidates: Array<Record<string, unknown>> = [];
  const symbols = [...parsed.data.text.matchAll(/\b[A-Z]{1,6}\b/gu)].map((match) => match[0]);
  for (const symbol of symbols) {
    const instrument = db.prepare("SELECT id, symbol, name FROM instruments WHERE symbol = ?").get(symbol) as Record<string, unknown> | undefined;
    if (instrument) candidates.push({ instrumentId: instrument.id, symbol: instrument.symbol, name: instrument.name, quantity: "1", cost: "0" });
  }
  const id = createId("holding_parse"); const now = isoNow();
  db.prepare("INSERT INTO holding_parses (id,user_id,raw_text,candidates_json,status,created_at) VALUES (?,?,?,?,?,?)").run(id, getRequestContext(req).userId, parsed.data.text, JSON.stringify(candidates), "pending", now); db.close();
  return NextResponse.json({ data: { parseId: id, status: "PENDING", candidates, issues: candidates.length ? [] : ["No supported instrument symbol found"], suggestedMatches: [] }, meta: meta() }, { status: 202 });
}
