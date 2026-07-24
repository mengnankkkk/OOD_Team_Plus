import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { authError, requireAdmin } from "@/server/auth/http";
import {
  batchDeleteSchema,
  createColumnSchema,
  createDomainSchema,
  createForeignKeySchema,
  createTableSchema,
  parsePageQuery,
  syncMetadataSchema,
  updateColumnSchema,
  updateDomainSchema,
  updateForeignKeySchema,
  updateTableSchema,
} from "@/server/semantic-layer/contract";
import { createColumn, deleteColumns, getColumn, pageColumns, updateColumn } from "@/server/semantic-layer/column-service";
import { createDomain, deleteDomains, getDomain, pageDomains, updateDomain } from "@/server/semantic-layer/domain-service";
import { createForeignKey, deleteForeignKeys, getForeignKey, pageForeignKeys, updateForeignKey } from "@/server/semantic-layer/foreign-key-service";
import { getSemanticLayerDb } from "@/server/semantic-layer/runtime";
import { syncSemanticMetadata } from "@/server/semantic-layer/sync-service";
import { createTable, deleteTables, getTable, pageTables, updateTable } from "@/server/semantic-layer/table-service";
import { getRequestContext } from "@/server/http/context";
import { discoverSemanticDatasources } from "@/server/semantic-layer/datasource-service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    requireAdmin(getRequestContext(request).user);
    const path = (await context.params).path;
    if (path.length === 1 && path[0] === "datasources") return NextResponse.json(discoverSemanticDatasources());
    const db = await getSemanticLayerDb();
    if (path.length === 1 && path[0] === "domains") return NextResponse.json(await pageDomains(db, parsePageQuery(request.url)));
    if (path.length === 2 && path[0] === "domains") return entity(await getDomain(db, path[1]));
    if (path.length === 1 && path[0] === "tables") return NextResponse.json(await pageTables(db, parsePageQuery(request.url), request.nextUrl.searchParams.get("domainId") ?? undefined));
    if (path.length === 2 && path[0] === "tables") return entity(await getTable(db, path[1]));
    if (path.length === 3 && path[0] === "tables" && path[2] === "columns") return NextResponse.json(await pageColumns(db, parsePageQuery(request.url), path[1]));
    if (path.length === 1 && path[0] === "columns") return NextResponse.json(await pageColumns(db, parsePageQuery(request.url), request.nextUrl.searchParams.get("tableId") ?? undefined));
    if (path.length === 2 && path[0] === "columns") return entity(await getColumn(db, path[1]));
    if (path.length === 1 && path[0] === "logical-foreign-keys") return NextResponse.json(await pageForeignKeys(
      db,
      parsePageQuery(request.url),
      request.nextUrl.searchParams.get("sourceTableId") ?? undefined,
      request.nextUrl.searchParams.get("targetTableId") ?? undefined,
    ));
    if (path.length === 2 && path[0] === "logical-foreign-keys") return entity(await getForeignKey(db, path[1]));
    return notFound();
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    requireAdmin(getRequestContext(request).user);
    const path = (await context.params).path;
    const body = await request.json();
    const db = await getSemanticLayerDb();
    if (path.length === 1 && path[0] === "domains") return NextResponse.json(await createDomain(db, createDomainSchema.parse(body)), { status: 201 });
    if (path.length === 2 && path[0] === "domains" && path[1] === "batch-delete") return NextResponse.json(await deleteDomains(db, batchDeleteSchema.parse(body).ids));
    if (path.length === 1 && path[0] === "tables") return NextResponse.json(await createTable(db, createTableSchema.parse(body)), { status: 201 });
    if (path.length === 2 && path[0] === "tables" && path[1] === "batch-delete") return NextResponse.json(await deleteTables(db, batchDeleteSchema.parse(body).ids));
    if (path.length === 3 && path[0] === "tables" && path[2] === "columns") return NextResponse.json(await createColumn(db, path[1], createColumnSchema.parse(body)), { status: 201 });
    if (path.length === 2 && path[0] === "columns" && path[1] === "batch-delete") return NextResponse.json(await deleteColumns(db, batchDeleteSchema.parse(body).ids));
    if (path.length === 1 && path[0] === "logical-foreign-keys") return NextResponse.json(await createForeignKey(db, createForeignKeySchema.parse(body)), { status: 201 });
    if (path.length === 2 && path[0] === "logical-foreign-keys" && path[1] === "batch-delete") return NextResponse.json(await deleteForeignKeys(db, batchDeleteSchema.parse(body).ids));
    if (path.length === 1 && path[0] === "sync") return NextResponse.json(await syncSemanticMetadata(db, syncMetadataSchema.parse(body)));
    return notFound();
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    requireAdmin(getRequestContext(request).user);
    const path = (await context.params).path;
    const body = await request.json();
    const db = await getSemanticLayerDb();
    if (path.length !== 2) return notFound();
    if (path[0] === "domains") return entity(await updateDomain(db, path[1], updateDomainSchema.parse(body)));
    if (path[0] === "tables") return entity(await updateTable(db, path[1], updateTableSchema.parse(body)));
    if (path[0] === "columns") return entity(await updateColumn(db, path[1], updateColumnSchema.parse(body)));
    if (path[0] === "logical-foreign-keys") return entity(await updateForeignKey(db, path[1], updateForeignKeySchema.parse(body)));
    return notFound();
  } catch (error) {
    return routeError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    requireAdmin(getRequestContext(request).user);
    const path = (await context.params).path;
    if (path.length !== 2) return notFound();
    const db = await getSemanticLayerDb();
    if (path[0] === "domains") return NextResponse.json(await deleteDomains(db, [path[1]]));
    if (path[0] === "tables") return NextResponse.json(await deleteTables(db, [path[1]]));
    if (path[0] === "columns") return NextResponse.json(await deleteColumns(db, [path[1]]));
    if (path[0] === "logical-foreign-keys") return NextResponse.json(await deleteForeignKeys(db, [path[1]]));
    return notFound();
  } catch (error) {
    return routeError(error);
  }
}

function entity(value: unknown) {
  return value ? NextResponse.json(value) : notFound();
}

function notFound() {
  return NextResponse.json({ error: { code: "RESOURCE_NOT_FOUND", message: "Semantic resource not found" } }, { status: 404 });
}

function routeError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid semantic layer request", details: error.format() } }, { status: 422 });
  const response = authError(error);
  if (response.status !== 500) return response;
  const message = error instanceof Error ? error.message : "Semantic layer operation failed";
  const status = /UNIQUE constraint/iu.test(message) ? 409 : /Missing active|does not belong/iu.test(message) ? 422 : 500;
  return NextResponse.json({ error: { code: status === 409 ? "RESOURCE_CONFLICT" : status === 422 ? "VALIDATION_ERROR" : "INTERNAL_ERROR", message } }, { status });
}
