export const metadataSchemaSql = `
create table if not exists metadata_domains (
  id text primary key,
  name text not null,
  description text,
  is_visible integer not null default 1,
  status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  unique(name)
);

create index if not exists idx_metadata_domains_list
  on metadata_domains(status, is_visible, updated_at);

create table if not exists metadata_semantic_tables (
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

create index if not exists idx_metadata_semantic_tables_list
  on metadata_semantic_tables(domain_id, status, is_visible, updated_at);

create index if not exists idx_metadata_semantic_tables_keyword
  on metadata_semantic_tables(physical_table_name, semantic_name);

create table if not exists metadata_semantic_columns (
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

create index if not exists idx_metadata_semantic_columns_list
  on metadata_semantic_columns(table_id, status, is_visible, ordinal_position);

create index if not exists idx_metadata_semantic_columns_updated
  on metadata_semantic_columns(status, is_visible, updated_at);

create table if not exists metadata_logical_foreign_keys (
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
  foreign key (source_table_id) references metadata_semantic_tables(id),
  foreign key (source_column_id) references metadata_semantic_columns(id),
  foreign key (target_table_id) references metadata_semantic_tables(id),
  foreign key (target_column_id) references metadata_semantic_columns(id),
  unique(source_column_id, target_column_id)
);

create index if not exists idx_metadata_logical_fks_source
  on metadata_logical_foreign_keys(source_table_id, status, is_visible, updated_at);

create index if not exists idx_metadata_logical_fks_target
  on metadata_logical_foreign_keys(target_table_id, status, is_visible, updated_at);
`;
