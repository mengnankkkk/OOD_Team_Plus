import { jsonError } from "@/server/chat/errors";
import {
  createColumnSchema,
  entityIdSchema,
  parsePageQuery,
} from "@/server/semantic-layer/contract";
import {
  createColumn,
  pageColumns,
} from "@/server/semantic-layer/column-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

type Context = { params: Promise<{ tableId: string }> };

async function tableId(context: Context) {
  return entityIdSchema.parse((await context.params).tableId);
}

export async function GET(request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    return Response.json(
      await pageColumns(db, parsePageQuery(request.url), await tableId(context)),
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const body = createColumnSchema.parse(await request.json());
    return Response.json(await createColumn(db, await tableId(context), body), {
      status: 201,
    });
  } catch (error) {
    return jsonError(error);
  }
}
