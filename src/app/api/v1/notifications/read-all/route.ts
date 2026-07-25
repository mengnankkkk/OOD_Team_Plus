import { NextRequest, NextResponse } from "next/server";

import { getDatabase, getRequestContext, isoNow, meta } from "@/server/http/context";

export async function POST(req: NextRequest) {
  const { userId } = getRequestContext(req);
  const now = isoNow();
  const db = getDatabase();
  const result = db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,?),updated_at=?,row_version=row_version+1
    WHERE user_id=? AND dismissed_at IS NULL AND read_at IS NULL`).run(now, now, userId);
  db.close();
  return NextResponse.json({ data: { updatedCount: result.changes }, meta: meta() });
}
