import { jsonError } from "@/server/chat/errors";
import {
  entityIdSchema,
  updateForeignKeySchema,
} from "@/server/semantic-layer/contract";
import {
  deleteForeignKeys,
  getForeignKey,
  updateForeignKey,
} from "@/server/semantic-layer/foreign-key-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

type Context = { params: Promise<{ foreignKeyId: string }> };

async function foreignKeyId(context: Context) {
  return entityIdSchema.parse((await context.params).foreignKeyId);
}

export async function GET(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const fk = await getForeignKey(db, await foreignKeyId(context));
    return fk ? Response.json(fk) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const body = updateForeignKeySchema.parse(await request.json());
    const fk = await updateForeignKey(db, await foreignKeyId(context), body);
    return fk ? Response.json(fk) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    return Response.json(await deleteForeignKeys(db, [await foreignKeyId(context)]));
  } catch (error) {
    return jsonError(error);
  }
}
