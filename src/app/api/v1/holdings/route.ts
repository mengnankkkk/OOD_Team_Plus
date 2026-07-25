import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createId, getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";
import { syncPortfolioFromHoldings } from "@/server/extensions/analysis/service";
const Decimal = z.string().regex(/^\d+(?:\.\d+)?$/u);
const Schema=z.object({instrumentId:z.string().min(1),quantity:Decimal.refine((value) => Number(value) > 0),cost:Decimal,portfolioId:z.string().min(1).default("portfolio-demo"),openedAt:z.string().nullable().optional()});
export async function GET(req: NextRequest) {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      h.*,
      i.symbol,
      i.name,
      i.asset_type,
      i.sector,
      (
        SELECT hs.price_decimal
        FROM holding_snapshots hs
        JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
        WHERE ps.user_id = h.user_id
          AND ps.portfolio_id = h.portfolio_id
          AND hs.instrument_id = h.instrument_id
        ORDER BY ps.created_at DESC, hs.created_at DESC
        LIMIT 1
      ) AS current_price_decimal,
      (
        SELECT hs.market_value_decimal
        FROM holding_snapshots hs
        JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
        WHERE ps.user_id = h.user_id
          AND ps.portfolio_id = h.portfolio_id
          AND hs.instrument_id = h.instrument_id
        ORDER BY ps.created_at DESC, hs.created_at DESC
        LIMIT 1
      ) AS market_value_decimal,
      (
        SELECT ps.as_of
        FROM holding_snapshots hs
        JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
        WHERE ps.user_id = h.user_id
          AND ps.portfolio_id = h.portfolio_id
          AND hs.instrument_id = h.instrument_id
        ORDER BY ps.created_at DESC, hs.created_at DESC
        LIMIT 1
      ) AS price_as_of,
      (
        SELECT ps.source_statuses_json
        FROM holding_snapshots hs
        JOIN portfolio_snapshots ps ON ps.id = hs.portfolio_snapshot_id
        WHERE ps.user_id = h.user_id
          AND ps.portfolio_id = h.portfolio_id
          AND hs.instrument_id = h.instrument_id
        ORDER BY ps.created_at DESC, hs.created_at DESC
        LIMIT 1
      ) AS price_sources_json
    FROM holdings h
    LEFT JOIN instruments i ON i.id = h.instrument_id
    WHERE h.user_id = ? AND h.status = 'active'
    ORDER BY h.created_at DESC
  `).all(getRequestContext(req).userId);
  db.close();
  return NextResponse.json({ data: { items: rows }, meta: meta() });
}
export async function POST(req:NextRequest){const parsed=Schema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:{code:"INVALID_REQUEST",message:"Invalid holding",details:parsed.error.format()}},{status:400});const now=isoNow();const userId=getRequestContext(req).userId;const db=getDatabase();const id=createId("holding");const instrument=db.prepare("SELECT id FROM instruments WHERE id=? AND tradable=1").get(parsed.data.instrumentId);if(!instrument){db.close();return NextResponse.json({error:{code:"RESOURCE_NOT_FOUND",message:"Tradable instrument not found"}},{status:404});}const existing=db.prepare("SELECT id FROM holdings WHERE user_id=? AND portfolio_id=? AND instrument_id=? AND status='active'").get(userId,parsed.data.portfolioId,parsed.data.instrumentId);if(existing){db.close();return NextResponse.json({error:{code:"HOLDING_ALREADY_EXISTS",message:"Holding already exists"}},{status:409});}db.prepare("INSERT INTO holdings (id,user_id,portfolio_id,instrument_id,quantity_decimal,cost_decimal,opened_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id,userId,parsed.data.portfolioId,parsed.data.instrumentId,parsed.data.quantity,parsed.data.cost,parsed.data.openedAt??null,now,now);const row=db.prepare("SELECT * FROM holdings WHERE id=?").get(id);db.close();syncPortfolioFromHoldings(userId,parsed.data.portfolioId);return NextResponse.json({data:row,meta:meta()},{status:201});}
