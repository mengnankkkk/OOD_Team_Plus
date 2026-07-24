import { jsonError } from "@/server/chat/errors";
import { batchDeleteSchema } from "@/server/semantic-layer/contract";
import { deleteForeignKeys } from "@/server/semantic-layer/foreign-key-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const { ids } = batchDeleteSchema.parse(await request.json());
    return Response.json(await deleteForeignKeys(db, ids));
  } catch (error) {
    return jsonError(error);
  }
}
