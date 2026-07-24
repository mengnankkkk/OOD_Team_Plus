
CREATE TABLE IF NOT EXISTS public.semantic_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  description text,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.semantic_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  domain_id uuid NOT NULL REFERENCES public.semantic_domains(id) ON DELETE CASCADE,
  datasource_key text,
  schema_name text,
  physical_table_name text NOT NULL,
  physical_description text,
  semantic_name text,
  semantic_description text,
  is_visible boolean NOT NULL DEFAULT true,
  sync_status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.semantic_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  table_id uuid NOT NULL REFERENCES public.semantic_tables(id) ON DELETE CASCADE,
  physical_column_name text NOT NULL,
  ordinal_position integer,
  data_type text,
  is_nullable boolean NOT NULL DEFAULT true,
  is_primary_key boolean NOT NULL DEFAULT false,
  default_value text,
  physical_description text,
  semantic_name text,
  semantic_description text,
  business_type text,
  example_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_visible boolean NOT NULL DEFAULT true,
  sync_status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.semantic_logical_foreign_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  source_table_id uuid NOT NULL REFERENCES public.semantic_tables(id) ON DELETE CASCADE,
  source_column_id uuid NOT NULL REFERENCES public.semantic_columns(id) ON DELETE CASCADE,
  target_table_id uuid NOT NULL REFERENCES public.semantic_tables(id) ON DELETE CASCADE,
  target_column_id uuid NOT NULL REFERENCES public.semantic_columns(id) ON DELETE CASCADE,
  relation_type text NOT NULL DEFAULT 'many_to_one',
  source_type text NOT NULL DEFAULT 'manual',
  confidence numeric(4,3) NOT NULL DEFAULT 1,
  physical_description text,
  semantic_description text,
  is_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_semantic_domains_user ON public.semantic_domains(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_tables_user_domain ON public.semantic_tables(user_id, domain_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_columns_user_table ON public.semantic_columns(user_id, table_id, ordinal_position);
CREATE INDEX IF NOT EXISTS idx_semantic_fk_user ON public.semantic_logical_foreign_keys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_fk_source_col ON public.semantic_logical_foreign_keys(source_column_id);
CREATE INDEX IF NOT EXISTS idx_semantic_fk_target_col ON public.semantic_logical_foreign_keys(target_column_id);
