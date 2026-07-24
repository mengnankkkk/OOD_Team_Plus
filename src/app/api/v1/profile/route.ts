import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

const ProfileSchema = z.object({ riskLevel: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).nullable().optional(), investmentAmount: z.string().optional(), targetAmount: z.string().optional(), targetDate: z.string().nullable().optional(), horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).nullable().optional(), priority: z.enum(["STOCK", "SECTOR", "INDEX"]).nullable().optional(), preferences: z.record(z.string(), z.unknown()).optional() });

export async function GET(req: NextRequest) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(getRequestContext(req).userId) as Record<string, unknown> | undefined;
  db.close();
  return NextResponse.json({ data: row ? format(row) : { status: "DRAFT", version: 0, riskLevel: null, preferences: {} }, meta: meta() });
}

export async function PATCH(req: NextRequest) {
  const parsed = ProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "Invalid profile", details: parsed.error.format() } }, { status: 400 });
  const { userId } = getRequestContext(req);
  const db = getDatabase();
  const now = isoNow();
  const currentVersion = req.headers.get("If-Match");
  const existing = db.prepare("SELECT version FROM user_profiles WHERE user_id = ?").get(userId) as { version?: number } | undefined;
  if (existing && currentVersion && Number(currentVersion.replaceAll('"', "")) !== existing.version) {
    db.close();
    return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Profile was modified", details: { currentVersion: existing.version } } }, { status: 412 });
  }
  db.prepare(`INSERT INTO user_profiles (id, user_id, risk_level, investment_amount_decimal, target_amount_decimal, target_date, horizon, priority, preferences_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET risk_level=excluded.risk_level, investment_amount_decimal=excluded.investment_amount_decimal, target_amount_decimal=excluded.target_amount_decimal, target_date=excluded.target_date, horizon=excluded.horizon, priority=excluded.priority, preferences_json=excluded.preferences_json, version=user_profiles.version+1, updated_at=excluded.updated_at`)
    .run(createId("profile"), userId, parsed.data.riskLevel ?? null, parsed.data.investmentAmount ?? null, parsed.data.targetAmount ?? null, parsed.data.targetDate ?? null, parsed.data.horizon ?? null, parsed.data.priority ?? null, JSON.stringify(parsed.data.preferences ?? {}), now, now);
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown>;
  db.close();
  return NextResponse.json({ data: format(row), meta: meta() });
}

function format(row: Record<string, unknown>) { return { id: row.id, status: String(row.status).toUpperCase(), riskLevel: row.risk_level, investmentAmount: row.investment_amount_decimal, targetAmount: row.target_amount_decimal, targetDate: row.target_date, horizon: row.horizon, priority: row.priority, preferences: JSON.parse(String(row.preferences_json ?? "{}")), version: row.version, updatedAt: row.updated_at }; }
