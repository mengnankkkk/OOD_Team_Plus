import { jsonError } from "@/server/chat/errors";
import { syncMetadataSchema } from "@/server/semantic-layer/contract";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";
import { syncSemanticMetadata } from "@/server/semantic-layer/sync-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const body = syncMetadataSchema.parse(await request.json());
    return Response.json(await syncSemanticMetadata(db, body));
  } catch (error) {
    return jsonError(error);
  }
}
