set search_path = pg_catalog;
\pset format unaligned
\pset tuples_only on
select 'table|'||n.nspname||'.'||c.relname||'|'||c.relkind::text||'|rls='||c.relrowsecurity||'|force='||c.relforcerowsecurity||'|owner='||pg_get_userbyid(c.relowner)||'|acl='||coalesce(c.relacl::text,'')
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema','pg_toast') and c.relkind in ('r','v','m','S','p','f')
union all select 'col|'||table_schema||'.'||table_name||'.'||column_name||'|'||data_type||'|'||udt_name||'|'||is_nullable||'|'||coalesce(column_default,'')||'|'||coalesce(is_generated,'')||'|'||coalesce(generation_expression,'')
 from information_schema.columns where table_schema not in ('pg_catalog','information_schema')
union all select 'idx|'||schemaname||'.'||tablename||'|'||indexname||'|'||indexdef from pg_indexes where schemaname not in ('pg_catalog','information_schema')
union all select 'con|'||conrelid::regclass||'|'||conname||'|'||contype::text||'|'||pg_get_constraintdef(oid) from pg_constraint where connamespace in (select oid from pg_namespace where nspname not in ('pg_catalog','information_schema'))
union all select 'fn|'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||md5(pg_get_functiondef(p.oid))||'|owner='||pg_get_userbyid(p.proowner)||'|acl='||coalesce(p.proacl::text,'')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') and p.prokind in ('f','p')
union all select 'trg|'||tgrelid::regclass||'|'||tgname||'|'||md5(pg_get_triggerdef(oid)) from pg_trigger where not tgisinternal
union all select 'pol|'||schemaname||'.'||tablename||'|'||policyname||'|'||cmd::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||roles::text from pg_policies
union all select 'colacl|'||attrelid::regclass||'.'||attname||'|'||attacl::text from pg_attribute where attacl is not null and attrelid in (select oid from pg_class where relnamespace in (select oid from pg_namespace where nspname not in ('pg_catalog','information_schema')))
union all select 'defacl|'||pg_get_userbyid(defaclrole)||'|'||defaclnamespace::regnamespace||'|'||defaclobjtype::text||'|'||defaclacl::text from pg_default_acl
union all select 'ext|'||extname from pg_extension
union all select 'ns|'||nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce(nspacl::text,'') from pg_namespace where nspname not in ('pg_catalog','information_schema','pg_toast')
union all select 'enum|'||t.typname||'|'||string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid group by t.typname
union all select 'mig|'||name||'|'||checksum from app.schema_migrations
union all select 'cfg|'||key||'|'||(case when key like '%_from' then '<ts>' else value::text end) from public.system_config
union all select 'duty|'||coalesce(slug,'')||'|enabled='||enabled from public.responsibilities
order by 1;
