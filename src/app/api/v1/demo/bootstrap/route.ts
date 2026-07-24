import { NextRequest, NextResponse } from "next/server";

import { authError, requireAdmin } from "@/server/auth/http";
import { AuthFailure } from "@/server/auth/contracts";
import { syncPortfolioFromHoldings } from "@/server/extensions/analysis/service";
import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = getRequestContext(request);
    requireAdmin(context.user);
    const now = isoNow();
    const db = getDatabase();
    const portfolioId = "portfolio-demo";
    const seededHoldingIds: string[] = [];
    const transaction = db.transaction(() => {
      db.prepare(`INSERT OR IGNORE INTO instruments (id, symbol, name, market, asset_type, sector, tradable) VALUES
        ('AAPL', 'AAPL', 'Apple', 'NASDAQ', 'stock', 'Technology', 1),
        ('MSFT', 'MSFT', 'Microsoft', 'NASDAQ', 'stock', 'Technology', 1),
        ('SPY', 'SPY', 'SPDR S&P 500 ETF', 'NYSE', 'fund', 'Broad Market', 1),
        ('GLD', 'GLD', 'SPDR Gold Shares', 'NYSE', 'fund', 'Commodities', 1),
        ('000300.SH', '000300.SH', '沪深300指数', 'SH', 'index', 'Broad Market', 0),
        ('510300.SH', '510300.SH', '沪深300ETF', 'SH', 'fund', 'Broad Market', 1)`).run();
      db.prepare(`INSERT OR IGNORE INTO data_sources
        (id, source_type, label, created_at, code, name, provider, version, reliability_level, is_enabled)
        VALUES
        ('source-pandadata-api', 'pandadata', 'PandaData API', ?, 'pandadata_api', 'PandaData API', 'PandaAIQuant Data Service', '0.0.12', 'primary', 1),
        ('source-derived-engine', 'derived_engine', 'Derived engine', ?, 'derived_engine', 'Derived engine', 'Money Whisperer', '1', 'derived', 1)`).run(now, now);
      db.prepare(`INSERT INTO user_profiles
        (id, user_id, risk_level, investment_amount_decimal, horizon, preferences_json, max_drawdown_decimal, status, created_at, updated_at)
        VALUES (?, ?, 'MEDIUM', '100000', 'MEDIUM', ?, '0.15', 'active', ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          risk_level=excluded.risk_level,
          investment_amount_decimal=excluded.investment_amount_decimal,
          horizon=excluded.horizon,
          preferences_json=excluded.preferences_json,
          max_drawdown_decimal=excluded.max_drawdown_decimal,
          status='active',
          updated_at=excluded.updated_at,
          version=user_profiles.version+1`).run(
        createId("profile"),
        context.userId,
        JSON.stringify({ instrumentPreference: "balanced", nearTermUse: false }),
        now,
        now,
      );
      for (const holding of [
        { instrumentId: "AAPL", quantity: "12", cost: "185" },
        { instrumentId: "MSFT", quantity: "8", cost: "420" },
        { instrumentId: "SPY", quantity: "15", cost: "510" },
      ]) {
        const existing = db.prepare("SELECT id FROM holdings WHERE user_id=? AND portfolio_id=? AND instrument_id=? AND status='active'")
          .get(context.userId, portfolioId, holding.instrumentId) as { id?: string } | undefined;
        if (existing?.id) {
          seededHoldingIds.push(existing.id);
          continue;
        }
        const holdingId = createId("holding");
        db.prepare(`INSERT INTO holdings
          (id, user_id, portfolio_id, instrument_id, quantity_decimal, cost_decimal, opened_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          holdingId, context.userId, portfolioId, holding.instrumentId, holding.quantity, holding.cost, now, now, now,
        );
        seededHoldingIds.push(holdingId);
      }
    });
    transaction();
    db.close();
    const snapshot = syncPortfolioFromHoldings(context.userId, portfolioId);
    return NextResponse.json({ data: { portfolioId, holdingIds: seededHoldingIds, portfolioSnapshotId: snapshot.snapshotId }, meta: meta() });
  } catch (error) {
    if (error instanceof AuthFailure) return authError(error);
    return NextResponse.json({ error: { code: "DEMO_BOOTSTRAP_FAILED", message: "Demo bootstrap failed" } }, { status: 500 });
  }
}
