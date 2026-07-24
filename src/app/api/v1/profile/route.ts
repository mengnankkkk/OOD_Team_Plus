import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

const ProfileSchema = z.object({ riskLevel: z.enum(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]).nullable().optional(), investmentAmount: z.string().optional(), targetAmount: z.string().optional(), targetDate: z.string().nullable().optional(), horizon: z.enum(["SHORT", "MEDIUM", "LONG"]).nullable().optional(), priority: z.enum(["STOCK", "SECTOR", "INDEX"]).nullable().optional(), maxDrawdown: z.string().nullable().optional(), preferences: z.record(z.string(), z.unknown()).optional() });

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
  const existing = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
  if (existing && !currentVersion) {
    db.close();
    return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "If-Match required", details: { currentVersion: existing.version } } }, { status: 412 });
  }
  if (existing && Number(currentVersion?.replaceAll('"', "")) !== existing.version) {
    db.close();
    return NextResponse.json({ error: { code: "VERSION_CONFLICT", message: "Profile was modified", details: { currentVersion: existing.version } } }, { status: 412 });
  }
  const previousPreferences = existing ? JSON.parse(String(existing.preferences_json ?? "{}")) as Record<string, unknown> : {};
  const preferences = { ...previousPreferences, ...(parsed.data.preferences ?? {}) };
  const keep = (value: unknown, previous: unknown) => value === undefined ? previous ?? null : value;
  db.prepare(`INSERT INTO user_profiles (id, user_id, risk_level, investment_amount_decimal, target_amount_decimal, target_date, horizon, priority, max_drawdown_decimal, preferences_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET risk_level=excluded.risk_level, investment_amount_decimal=excluded.investment_amount_decimal, target_amount_decimal=excluded.target_amount_decimal, target_date=excluded.target_date, horizon=excluded.horizon, priority=excluded.priority, max_drawdown_decimal=excluded.max_drawdown_decimal, preferences_json=excluded.preferences_json, version=user_profiles.version+1, updated_at=excluded.updated_at`)
    .run(createId("profile"), userId, keep(parsed.data.riskLevel, existing?.risk_level), keep(parsed.data.investmentAmount, existing?.investment_amount_decimal), keep(parsed.data.targetAmount, existing?.target_amount_decimal), keep(parsed.data.targetDate, existing?.target_date), keep(parsed.data.horizon, existing?.horizon), keep(parsed.data.priority, existing?.priority), keep(parsed.data.maxDrawdown, existing?.max_drawdown_decimal), JSON.stringify(preferences), now, now);
  const row = db.prepare("SELECT * FROM user_profiles WHERE user_id = ?").get(userId) as Record<string, unknown>;
  db.close();
  return NextResponse.json({ data: format(row), meta: meta() });
}

function format(row: Record<string, unknown>) { return { id: row.id, status: String(row.status).toUpperCase(), riskLevel: row.risk_level, investmentAmount: row.investment_amount_decimal, targetAmount: row.target_amount_decimal, targetDate: row.target_date, horizon: row.horizon, priority: row.priority, maxDrawdown: row.max_drawdown_decimal, preferences: JSON.parse(String(row.preferences_json ?? "{}")), version: row.version, updatedAt: row.updated_at }; }
