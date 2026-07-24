import { jsonError } from "@/server/chat/errors";
import { parsePageQuery } from "@/server/semantic-layer/contract";
import { pageColumns } from "@/server/semantic-layer/column-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const tableId = new URL(request.url).searchParams.get("tableId") ?? undefined;
    return Response.json(await pageColumns(db, parsePageQuery(request.url), tableId));
  } catch (error) {
    return jsonError(error);
  }
}
