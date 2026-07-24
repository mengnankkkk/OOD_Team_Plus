import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const entityIdSchema = z.string().trim().min(1).max(128);

export const pageQuerySchema = z.object({
  pageNo: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().trim().min(1).max(100).optional(),
  isVisible: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  sortBy: z.enum(["updatedAt", "createdAt", "name"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export const batchDeleteSchema = z.object({
  ids: z.array(entityIdSchema).min(1).max(100),
});

export const createDomainSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: optionalText(2_000),
  isVisible: z.boolean().default(true),
});

export const updateDomainSchema = createDomainSchema
  .pick({ name: true, description: true, isVisible: true })
  .partial();

export const createTableSchema = z.object({
  domainId: entityIdSchema,
  datasourceKey: z.string().trim().min(1).max(128),
  schemaName: optionalText(128),
  physicalTableName: z.string().trim().min(1).max(128),
  physicalDescription: optionalText(2_000),
  semanticName: optionalText(80),
  semanticDescription: optionalText(2_000),
  isVisible: z.boolean().default(true),
});

export const updateTableSchema = createTableSchema
  .pick({
    semanticName: true,
    semanticDescription: true,
    isVisible: true,
  })
  .partial();

export const createColumnSchema = z.object({
  physicalColumnName: z.string().trim().min(1).max(128),
  ordinalPosition: z.number().int().min(1),
  dataType: z.string().trim().min(1).max(128),
  isNullable: z.boolean().default(true),
  isPrimaryKey: z.boolean().default(false),
  defaultValue: optionalText(500),
  physicalDescription: optionalText(2_000),
  semanticName: optionalText(80),
  semanticDescription: optionalText(2_000),
  businessType: optionalText(80),
  exampleValues: z.array(z.string().trim().max(200)).max(20).optional(),
  isVisible: z.boolean().default(true),
});

const syncColumnSchema = createColumnSchema
  .pick({
    physicalColumnName: true,
    ordinalPosition: true,
    dataType: true,
    isNullable: true,
    isPrimaryKey: true,
    defaultValue: true,
    physicalDescription: true,
    semanticName: true,
    semanticDescription: true,
    businessType: true,
    exampleValues: true,
  })
  .extend({ isVisible: z.boolean().optional() });

const syncTableSchema = createTableSchema
  .pick({
    physicalTableName: true,
    physicalDescription: true,
    semanticName: true,
    semanticDescription: true,
  })
  .extend({
    isVisible: z.boolean().optional(),
    columns: z.array(syncColumnSchema).max(500).default([]),
  });

export const updateColumnSchema = createColumnSchema
  .pick({
    semanticName: true,
    semanticDescription: true,
    businessType: true,
    exampleValues: true,
    isVisible: true,
  })
  .partial();

export const relationTypeSchema = z.enum([
  "many_to_one",
  "one_to_one",
  "one_to_many",
]);

export const createForeignKeySchema = z.object({
  sourceTableId: entityIdSchema,
  sourceColumnId: entityIdSchema,
  targetTableId: entityIdSchema,
  targetColumnId: entityIdSchema,
  relationType: relationTypeSchema,
  sourceType: z.enum(["physical", "manual"]).default("manual"),
  confidence: z.number().min(0).max(1).default(1),
  physicalDescription: optionalText(2_000),
  semanticDescription: optionalText(2_000),
  isVisible: z.boolean().default(true),
});

const syncForeignKeySchema = z.object({
  sourcePhysicalTableName: z.string().trim().min(1).max(128),
  sourcePhysicalColumnName: z.string().trim().min(1).max(128),
  targetPhysicalTableName: z.string().trim().min(1).max(128),
  targetPhysicalColumnName: z.string().trim().min(1).max(128),
  relationType: relationTypeSchema.default("many_to_one"),
  confidence: z.number().min(0).max(1).default(1),
  physicalDescription: optionalText(2_000),
  semanticDescription: optionalText(2_000),
  isVisible: z.boolean().optional(),
});

export const syncMetadataSchema = z.object({
  datasourceKey: z.string().trim().min(1).max(128),
  schemaName: optionalText(128),
  domain: createDomainSchema,
  tables: z.array(syncTableSchema).min(1).max(200),
  foreignKeys: z.array(syncForeignKeySchema).max(500).default([]),
  markMissing: z.boolean().default(true),
});

const jdbcConnectionSchema = z.object({
  driver: z.enum(["sqlite", "libsql"]).optional(),
  url: z.string().trim().min(1).max(2_000),
  username: optionalText(256),
  password: optionalText(2_000),
  schemaName: optionalText(128),
});

export const scanMetadataSchema = z.object({
  datasourceKey: z.string().trim().min(1).max(128),
  domain: createDomainSchema,
  jdbc: jdbcConnectionSchema,
  tableNamePattern: optionalText(128),
  markMissing: z.boolean().default(true),
});

export const updateForeignKeySchema = createForeignKeySchema
  .pick({
    relationType: true,
    confidence: true,
    physicalDescription: true,
    semanticDescription: true,
    isVisible: true,
  })
  .partial();

export function parsePageQuery(url: string) {
  return pageQuerySchema.parse(Object.fromEntries(new URL(url).searchParams));
}
