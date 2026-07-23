import { jsonError } from "@/server/chat/errors";
import {
  createTableSchema,
  parsePageQuery,
} from "@/server/semantic-layer/contract";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";
import { createTable, pageTables } from "@/server/semantic-layer/table-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const domainId = new URL(request.url).searchParams.get("domainId") ?? undefined;
    return Response.json(await pageTables(db, parsePageQuery(request.url), domainId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const body = createTableSchema.parse(await request.json());
    return Response.json(await createTable(db, body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
