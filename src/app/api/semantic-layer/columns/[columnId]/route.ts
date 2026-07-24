import { jsonError } from "@/server/chat/errors";
import {
  entityIdSchema,
  updateColumnSchema,
} from "@/server/semantic-layer/contract";
import {
  deleteColumns,
  getColumn,
  updateColumn,
} from "@/server/semantic-layer/column-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

type Context = { params: Promise<{ columnId: string }> };

async function columnId(context: Context) {
  return entityIdSchema.parse((await context.params).columnId);
}

export async function GET(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const column = await getColumn(db, await columnId(context));
    return column ? Response.json(column) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const body = updateColumnSchema.parse(await request.json());
    const column = await updateColumn(db, await columnId(context), body);
    return column ? Response.json(column) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    return Response.json(await deleteColumns(db, [await columnId(context)]));
  } catch (error) {
    return jsonError(error);
  }
}
