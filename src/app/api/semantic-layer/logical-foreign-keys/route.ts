import { jsonError } from "@/server/chat/errors";
import {
  createForeignKeySchema,
  parsePageQuery,
} from "@/server/semantic-layer/contract";
import {
  createForeignKey,
  pageForeignKeys,
} from "@/server/semantic-layer/foreign-key-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const searchParams = new URL(request.url).searchParams;
    const sourceTableId = searchParams.get("sourceTableId") ?? undefined;
    const targetTableId = searchParams.get("targetTableId") ?? undefined;
    return Response.json(
      await pageForeignKeys(
        db,
        parsePageQuery(request.url),
        sourceTableId,
        targetTableId,
      ),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const body = createForeignKeySchema.parse(await request.json());
    return Response.json(await createForeignKey(db, body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
