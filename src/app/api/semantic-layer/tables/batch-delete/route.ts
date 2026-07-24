import { jsonError } from "@/server/chat/errors";
import { batchDeleteSchema } from "@/server/semantic-layer/contract";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";
import { deleteTables } from "@/server/semantic-layer/table-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const { ids } = batchDeleteSchema.parse(await request.json());
    return Response.json(await deleteTables(db, ids));
  } catch (error) {
    return jsonError(error);
  }
}
