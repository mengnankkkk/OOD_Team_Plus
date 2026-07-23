import { jsonError } from "@/server/chat/errors";
import {
  entityIdSchema,
  updateTableSchema,
} from "@/server/semantic-layer/contract";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";
import {
  deleteTables,
  getTable,
  updateTable,
} from "@/server/semantic-layer/table-service";

export const runtime = "nodejs";

type Context = { params: Promise<{ tableId: string }> };

async function tableId(context: Context) {
  return entityIdSchema.parse((await context.params).tableId);
}

export async function GET(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const table = await getTable(db, await tableId(context));
    return table ? Response.json(table) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const body = updateTableSchema.parse(await request.json());
    const table = await updateTable(db, await tableId(context), body);
    return table ? Response.json(table) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    return Response.json(await deleteTables(db, [await tableId(context)]));
  } catch (error) {
    return jsonError(error);
  }
}
