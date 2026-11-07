-- Migração de isolamento (etapa 2, frente Funções).
-- 1. Referências entre tabelas de negócio passam a usar chave composta com org_id:
--    uma linha nunca aponta para uma linha de outra empresa.
-- 2. Row Level Security em toda tabela com org_id (FORCE: vale também para o dono das tabelas).
--    A empresa da transação vem de app.org_id (definido por withOrg). Rotinas de sistema
--    (seed, roteamento de webhook, jobs que passam por várias empresas) usam app.bypass_rls = 'on'.
-- installation_routes fica fora do RLS: só guarda identificadores para achar a empresa de um webhook.

-- Chave única (org_id, id) em cada tabela referenciada, para servir de alvo das chaves compostas.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT DISTINCT ref.relname
    FROM pg_constraint c
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public' AND ref.relname <> 'orgs'
  LOOP
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I (org_id, id)', t || '_org_id_id_key', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Troca cada FK de coluna única entre tabelas de negócio por (org_id, coluna) → (org_id, id),
-- mantendo a ação de ON DELETE original.
DO $$
DECLARE
  r record;
  action text;
BEGIN
  FOR r IN
    SELECT c.conname, src.relname AS src_table, ref.relname AS ref_table,
           a.attname AS src_col, ra.attname AS ref_col, c.confdeltype
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = c.confkey[1]
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND ref.relname <> 'orgs'
      AND array_length(c.conkey, 1) = 1
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid AND x.attname = 'org_id' AND NOT x.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.confrelid AND x.attname = 'org_id' AND NOT x.attisdropped)
  LOOP
    action := CASE r.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.src_table, r.conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (org_id, %I) REFERENCES public.%I (org_id, %I) ON DELETE %s',
      r.src_table, r.conname, r.src_col, r.ref_table, r.ref_col, action
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- RLS em toda tabela com org_id, exceto installation_routes.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'installation_routes'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS echo_org_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY echo_org_isolation ON public.%I
         USING (current_setting(''app.bypass_rls'', true) = ''on'' OR org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)
         WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on'' OR org_id = nullif(current_setting(''app.org_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- A própria tabela de empresas: cada empresa só enxerga a si mesma.
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.orgs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS echo_org_isolation ON public.orgs;
--> statement-breakpoint
CREATE POLICY echo_org_isolation ON public.orgs
  USING (current_setting('app.bypass_rls', true) = 'on' OR id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on' OR id = nullif(current_setting('app.org_id', true), '')::uuid);
