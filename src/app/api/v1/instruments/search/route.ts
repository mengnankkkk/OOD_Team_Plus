import { NextRequest, NextResponse } from "next/server";
import { getDatabase, meta } from "@/server/http/context";

export async function GET(req: NextRequest) { const q=`%${req.nextUrl.searchParams.get("q")??""}%`; const db=getDatabase(); const rows=db.prepare("SELECT id,symbol,name,market,asset_type,sector,tradable FROM instruments WHERE symbol LIKE ? OR name LIKE ? LIMIT ?").all(q,q,Math.min(Number(req.nextUrl.searchParams.get("limit")??20),100)) as Array<Record<string,unknown>>; db.close(); return NextResponse.json({data:{items:rows.map(format)},meta:meta()}); }
function format(row:Record<string,unknown>){return{instrumentId:row.id,symbol:row.symbol,name:row.name,market:row.market,assetType:String(row.asset_type).toUpperCase(),sector:row.sector,tradable:Boolean(row.tradable)};}
