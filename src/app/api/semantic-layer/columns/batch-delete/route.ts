import { jsonError } from "@/server/chat/errors";
import { batchDeleteSchema } from "@/server/semantic-layer/contract";
import { deleteColumns } from "@/server/semantic-layer/column-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const { ids } = batchDeleteSchema.parse(await request.json());
    return Response.json(await deleteColumns(db, ids));
  } catch (error) {
    return jsonError(error);
  }
}
