# Agent 语义层 Metadata 后端契约

第一期后端只保留四类实体：领域、语义表、语义列、逻辑外键。返回给前端的 JSON 不再包含 `code`、`domainName`、`datasourceKey`、`tableType`、`displayName`、`usageNotes`、`owner`、`tags` 这些冗余字段。

`datasource_key` 仍作为后端同步定位字段保存在语义表中，但不返回前端。前端展示时直接使用 `semanticName ?? physicalTableName` 或 `semanticName ?? physicalColumnName`。

## 表结构

### `metadata_domains`

```sql
create table metadata_domains (
  id text primary key,
  name text not null,
  description text,
  is_visible integer not null default 1,
  status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  unique(name)
);
```

### `metadata_semantic_tables`

```sql
create table metadata_semantic_tables (
  id text primary key,
  domain_id text not null,
  datasource_key text not null,
  schema_name text,
  physical_table_name text not null,
  physical_description text,
  semantic_name text,
  semantic_description text,
  is_visible integer not null default 1,
  status text not null default 'active',
  sync_status text not null default 'active',
  last_synced_at text,
  created_at text not null,
  updated_at text not null,
  foreign key (domain_id) references metadata_domains(id),
  unique(datasource_key, schema_name, physical_table_name)
);
```

### `metadata_semantic_columns`

```sql
create table metadata_semantic_columns (
  id text primary key,
  table_id text not null,
  physical_column_name text not null,
  ordinal_position integer not null,
  data_type text not null,
  is_nullable integer not null default 1,
  is_primary_key integer not null default 0,
  default_value text,
  physical_description text,
  semantic_name text,
  semantic_description text,
  business_type text,
  example_values text,
  is_visible integer not null default 1,
  status text not null default 'active',
  sync_status text not null default 'active',
  last_synced_at text,
  created_at text not null,
  updated_at text not null,
  foreign key (table_id) references metadata_semantic_tables(id),
  unique(table_id, physical_column_name)
);
```

### `metadata_logical_foreign_keys`

```sql
create table metadata_logical_foreign_keys (
  id text primary key,
  source_table_id text not null,
  source_column_id text not null,
  target_table_id text not null,
  target_column_id text not null,
  relation_type text not null,
  source_type text not null default 'manual',
  confidence real not null default 1,
  physical_description text,
  semantic_description text,
  is_visible integer not null default 1,
  status text not null default 'active',
  sync_status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  unique(source_column_id, target_column_id)
);
```

## 通用分页

请求参数：

```http
pageNo=1&pageSize=20&keyword=orders&isVisible=true&sortBy=updatedAt&sortOrder=desc
```

返回结构：

```json
{
  "pageNo": 1,
  "pageSize": 20,
  "total": 1,
  "items": []
}
```

## 领域接口

### `GET /api/semantic-layer/domains`

```json
{
  "pageNo": 1,
  "pageSize": 20,
  "total": 1,
  "items": [
    {
      "id": "domain_id",
      "name": "交易",
      "description": "交易域",
      "isVisible": true,
      "createdAt": "2026-07-23T12:00:00.000Z",
      "updatedAt": "2026-07-23T12:00:00.000Z"
    }
  ]
}
```

### `POST /api/semantic-layer/domains`

```json
{
  "name": "交易",
  "description": "交易域",
  "isVisible": true
}
```

返回单个领域对象。

### `PATCH /api/semantic-layer/domains/:domainId`

```json
{
  "name": "交易",
  "description": "交易相关模型",
  "isVisible": false
}
```

## 语义表接口

### `GET /api/semantic-layer/tables?domainId=domain_id`

```json
{
  "pageNo": 1,
  "pageSize": 20,
  "total": 1,
  "items": [
    {
      "id": "table_id",
      "domainId": "domain_id",
      "schemaName": "public",
      "physicalTableName": "orders",
      "physicalDescription": "订单物理表描述",
      "semanticName": "订单主表",
      "semanticDescription": "记录交易生命周期",
      "isVisible": true,
      "syncStatus": "active",
      "createdAt": "2026-07-23T12:00:00.000Z",
      "updatedAt": "2026-07-23T12:00:00.000Z"
    }
  ]
}
```

### `POST /api/semantic-layer/tables`

`datasourceKey` 是后端定位字段，创建时需要传入，但不会在返回 JSON 中出现。

```json
{
  "domainId": "domain_id",
  "datasourceKey": "main",
  "schemaName": "public",
  "physicalTableName": "orders",
  "physicalDescription": "订单物理表描述",
  "semanticName": "订单主表",
  "semanticDescription": "记录交易生命周期",
  "isVisible": true
}
```

返回单个语义表对象。

### `PATCH /api/semantic-layer/tables/:tableId`

```json
{
  "semanticName": "订单主表",
  "semanticDescription": "用户维护的业务描述",
  "isVisible": false
}
```

## 语义列接口

### `GET /api/semantic-layer/tables/:tableId/columns`

```json
{
  "pageNo": 1,
  "pageSize": 20,
  "total": 1,
  "items": [
    {
      "id": "column_id",
      "tableId": "table_id",
      "physicalColumnName": "buyer_id",
      "ordinalPosition": 2,
      "dataType": "bigint",
      "isNullable": false,
      "isPrimaryKey": false,
      "defaultValue": null,
      "physicalDescription": "买家用户 ID",
      "semanticName": "买家ID",
      "semanticDescription": "订单买家用户 ID",
      "businessType": "user_id",
      "exampleValues": ["10001", "10002"],
      "isVisible": true,
      "syncStatus": "active",
      "createdAt": "2026-07-23T12:00:00.000Z",
      "updatedAt": "2026-07-23T12:00:00.000Z"
    }
  ]
}
```

### `POST /api/semantic-layer/tables/:tableId/columns`

```json
{
  "physicalColumnName": "buyer_id",
  "ordinalPosition": 2,
  "dataType": "bigint",
  "isNullable": false,
  "isPrimaryKey": false,
  "defaultValue": null,
  "physicalDescription": "买家用户 ID",
  "semanticName": "买家ID",
  "semanticDescription": "订单买家用户 ID",
  "businessType": "user_id",
  "exampleValues": ["10001"],
  "isVisible": true
}
```

### `PATCH /api/semantic-layer/columns/:columnId`

```json
{
  "semanticName": "买家ID",
  "semanticDescription": "用户维护的字段描述",
  "businessType": "user_id",
  "exampleValues": ["10001", "10002"],
  "isVisible": false
}
```

## 逻辑外键接口

### `GET /api/semantic-layer/logical-foreign-keys`

```json
{
  "pageNo": 1,
  "pageSize": 20,
  "total": 1,
  "items": [
    {
      "id": "fk_id",
      "sourceTableId": "orders_table_id",
      "sourceColumnId": "buyer_id_column_id",
      "targetTableId": "users_table_id",
      "targetColumnId": "id_column_id",
      "sourceTableName": "订单主表",
      "sourceColumnName": "买家ID",
      "targetTableName": "用户主表",
      "targetColumnName": "用户ID",
      "relationType": "many_to_one",
      "sourceType": "manual",
      "confidence": 1,
      "physicalDescription": "物理关联描述",
      "semanticDescription": "订单买家关联用户",
      "isVisible": true,
      "createdAt": "2026-07-23T12:00:00.000Z",
      "updatedAt": "2026-07-23T12:00:00.000Z"
    }
  ]
}
```

### `POST /api/semantic-layer/logical-foreign-keys`

```json
{
  "sourceTableId": "orders_table_id",
  "sourceColumnId": "buyer_id_column_id",
  "targetTableId": "users_table_id",
  "targetColumnId": "id_column_id",
  "relationType": "many_to_one",
  "sourceType": "manual",
  "confidence": 1,
  "physicalDescription": "物理关联描述",
  "semanticDescription": "订单买家关联用户",
  "isVisible": true
}
```

### `PATCH /api/semantic-layer/logical-foreign-keys/:foreignKeyId`

```json
{
  "relationType": "many_to_one",
  "confidence": 0.95,
  "physicalDescription": "物理关联描述",
  "semanticDescription": "用户维护的关联描述",
  "isVisible": false
}
```

## 删除接口

单个删除：

```http
DELETE /api/semantic-layer/domains/:domainId
DELETE /api/semantic-layer/tables/:tableId
DELETE /api/semantic-layer/columns/:columnId
DELETE /api/semantic-layer/logical-foreign-keys/:foreignKeyId
```

批量删除：

```json
{
  "ids": ["id_1", "id_2"]
}
```

返回：

```json
{
  "deleted": 2
}
```

## 同步接口

### `POST /api/semantic-layer/sync`

```json
{
  "datasourceKey": "main",
  "schemaName": "public",
  "domain": {
    "name": "交易",
    "description": "交易域",
    "isVisible": true
  },
  "tables": [
    {
      "physicalTableName": "orders",
      "physicalDescription": "订单物理表",
      "semanticName": "订单主表",
      "semanticDescription": "订单业务表",
      "isVisible": true,
      "columns": [
        {
          "physicalColumnName": "id",
          "ordinalPosition": 1,
          "dataType": "bigint",
          "isNullable": false,
          "isPrimaryKey": true,
          "defaultValue": null,
          "physicalDescription": "主键",
          "semanticName": "订单ID",
          "semanticDescription": "订单唯一标识",
          "businessType": "id",
          "exampleValues": ["1", "2"],
          "isVisible": true
        }
      ]
    }
  ],
  "foreignKeys": [
    {
      "sourcePhysicalTableName": "orders",
      "sourcePhysicalColumnName": "buyer_id",
      "targetPhysicalTableName": "users",
      "targetPhysicalColumnName": "id",
      "relationType": "many_to_one",
      "confidence": 1,
      "physicalDescription": "订单买家外键",
      "semanticDescription": "订单买家关联用户",
      "isVisible": true
    }
  ],
  "markMissing": true
}
```

返回：

```json
{
  "domain": { "created": 1, "updated": 0, "missing": 0, "skipped": 0 },
  "tables": { "created": 1, "updated": 0, "missing": 0, "skipped": 0 },
  "columns": { "created": 1, "updated": 0, "missing": 0, "skipped": 0 },
  "foreignKeys": { "created": 1, "updated": 0, "missing": 0, "skipped": 0 },
  "syncedAt": "2026-07-23T12:00:00.000Z"
}
```

## 错误返回

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "请求格式无效，请检查后重试。"
  }
}
```
