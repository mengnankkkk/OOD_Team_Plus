import { jsonError } from "@/server/chat/errors";
import { batchDeleteSchema } from "@/server/semantic-layer/contract";
import { deleteDomains } from "@/server/semantic-layer/domain-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const { ids } = batchDeleteSchema.parse(await request.json());
    return Response.json(await deleteDomains(db, ids));
  } catch (error) {
    return jsonError(error);
  }
}
