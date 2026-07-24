import {
  entityIdSchema,
  updateDomainSchema,
} from "@/server/semantic-layer/contract";
import {
  deleteDomains,
  getDomain,
  updateDomain,
} from "@/server/semantic-layer/domain-service";
import { jsonError } from "@/server/chat/errors";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

type Context = { params: Promise<{ domainId: string }> };

async function domainId(context: Context) {
  return entityIdSchema.parse((await context.params).domainId);
}

export async function GET(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const domain = await getDomain(db, await domainId(context));
    return domain ? Response.json(domain) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    const body = updateDomainSchema.parse(await request.json());
    const domain = await updateDomain(db, await domainId(context), body);
    return domain ? Response.json(domain) : Response.json(null, { status: 404 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const db = await getSemanticLayerDb();
    return Response.json(await deleteDomains(db, [await domainId(context)]));
  } catch (error) {
    return jsonError(error);
  }
}
