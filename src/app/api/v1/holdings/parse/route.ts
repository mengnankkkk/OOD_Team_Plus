import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { parseHoldingText, type HoldingParseInstrument } from "@/server/extensions/advisor/holding-parser";
import { createId, getDatabase, getRequestContext, isoNow, json, meta } from "@/server/http/context";

const Schema = z.object({ text: z.string().trim().min(1).max(2000), defaultMarket: z.string().trim().min(1).max(20).optional() });

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid holding text", details: parsed.error.format() } }, { status: 422 });
  const db = getDatabase();
  const instruments = db.prepare("SELECT id,symbol,name,market,asset_type,tradable FROM instruments ORDER BY symbol").all() as HoldingParseInstrument[];
  const candidates = parseHoldingText(parsed.data.text, instruments);
  const parseId = createId("holding_parse");
  const now = isoNow();
  db.prepare("INSERT INTO holding_parses (id,user_id,raw_text,candidates_json,status,created_at) VALUES (?,?,?,?,?,?)").run(parseId, getRequestContext(req).userId, parsed.data.text, json(candidates), "pending", now);
  db.close();
  const issues = candidates.flatMap((candidate) => candidate.issues);
  const suggestedMatches = candidates.flatMap((candidate) => candidate.suggestedMatches);
  return NextResponse.json({ data: { parseId, status: "NEEDS_CONFIRMATION", candidates, issues, suggestedMatches }, meta: meta() });
}
