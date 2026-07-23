import {
  createDomainSchema,
  parsePageQuery,
} from "@/server/semantic-layer/contract";
import { createDomain, pageDomains } from "@/server/semantic-layer/domain-service";
import { jsonError } from "@/server/chat/errors";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    return Response.json(await pageDomains(db, parsePageQuery(request.url)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const db = await getSemanticLayerDb();
    const body = createDomainSchema.parse(await request.json());
    return Response.json(await createDomain(db, body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
