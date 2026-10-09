-- R1c catalogue fingerprints (9 October 2026). Each is ONE read-only select over the system catalogue: no row of any product table, so no personal data.
-- They are run twice and compared: against production through the read-only endpoint
--   ALLOW_PRODUCTION_CHECKS=1 npx tsx scripts/release/preflight-read.ts --file=docs/audit/V1-R1C-CATALOGUE-FINGERPRINTS-2026-10-09.sql --full
-- and against the restored replica
--   npx tsx scripts/release/r1c-catalogue.ts r1c_dst
-- A hash that differs names a difference; the per-object lists (F11, F12) say which object.

-- F01 tables and columns (name, type, nullability), order-independent of dropped columns.
select count(distinct c.oid) as tables, count(*) as columns, md5(string_agg(n.nspname || '.' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, '|' order by n.nspname, c.relname, a.attname)) as md5 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace join pg_catalog.pg_attribute a on a.attrelid = c.oid where n.nspname in ('public', 'app') and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped;

-- F02 functions and procedures in public and app: count and a hash over each one's identity and full definition.
select count(*) as functions, md5(string_agg(n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' || md5(pg_catalog.pg_get_functiondef(p.oid)), '|' order by n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid))) as md5 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prokind in ('f', 'p');

-- F03 row security: tables with it on and forced, and the policies (count and a hash of their text).
select (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app') and c.relkind in ('r', 'p') and c.relrowsecurity) as rls_on, (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app') and c.relkind in ('r', 'p') and c.relforcerowsecurity) as rls_forced, (select count(*) from pg_catalog.pg_policies where schemaname in ('public', 'app')) as policies, (select md5(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || permissive || ':' || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by schemaname, tablename, policyname)) from pg_catalog.pg_policies where schemaname in ('public', 'app')) as policies_md5;

-- F04 table privileges (who may do what to each table) over public and app, by role name.
select count(*) as grants, md5(string_agg(n.nspname || '.' || c.relname || ':' || coalesce(r.rolname, 'public') || ':' || a.privilege_type, '|' order by n.nspname, c.relname, coalesce(r.rolname, 'public'), a.privilege_type)) as md5 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace cross join lateral pg_catalog.aclexplode(c.relacl) a left join pg_catalog.pg_roles r on r.oid = a.grantee where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v');

-- F05 function privileges (EXECUTE) over public and app, by role name.
select count(*) as grants, md5(string_agg(n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || '):' || coalesce(r.rolname, 'public') || ':' || a.privilege_type, '|' order by n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid), coalesce(r.rolname, 'public'))) as md5 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace cross join lateral pg_catalog.aclexplode(p.proacl) a left join pg_catalog.pg_roles r on r.oid = a.grantee where n.nspname in ('public', 'app') and p.prokind in ('f', 'p');

-- F06 triggers (user triggers on public and app tables): count, enabled states and a hash of each definition.
select count(*) as triggers, count(*) filter (where t.tgenabled = 'O') as enabled_origin, md5(string_agg(n.nspname || '.' || c.relname || ':' || t.tgname || ':' || t.tgenabled::text || ':' || pg_catalog.pg_get_triggerdef(t.oid), '|' order by n.nspname, c.relname, t.tgname)) as md5 from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('public', 'app');

-- F07 indexes over public and app: count and a hash of each definition.
select count(*) as indexes, md5(string_agg(schemaname || '.' || indexname || ':' || indexdef, '|' order by schemaname, indexname)) as md5 from pg_catalog.pg_indexes where schemaname in ('public', 'app');

-- F08 constraints over public and app tables: count by kind, how many are NOT VALID, and a hash of each definition.
select count(*) as constraints, count(*) filter (where not c.convalidated) as not_valid, md5(string_agg(n.nspname || '.' || cl.relname || ':' || c.conname || ':' || pg_catalog.pg_get_constraintdef(c.oid), '|' order by n.nspname, cl.relname, c.conname)) as md5 from pg_catalog.pg_constraint c join pg_catalog.pg_class cl on cl.oid = c.conrelid join pg_catalog.pg_namespace n on n.oid = cl.relnamespace where n.nspname in ('public', 'app');

-- F09 extensions the schema depends on (name and version).
select string_agg(extname || ' ' || extversion, ', ' order by extname) as extensions from pg_catalog.pg_extension;

-- F10 views in public and app: count and a hash of each definition.
select count(*) as views, md5(string_agg(schemaname || '.' || viewname || ':' || definition, '|' order by schemaname, viewname)) as md5 from pg_catalog.pg_views where schemaname in ('public', 'app');

-- F11 per-function hashes, so a differing hash in F02 can be named (name, argument list and a hash; never the definition).
select n.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as fn, md5(pg_catalog.pg_get_functiondef(p.oid)) as md5 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prokind in ('f', 'p') order by 1;

-- F12 per-table column hashes, so a differing hash in F01 can be named.
select n.nspname || '.' || c.relname as t, count(*) as cols, md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, '|' order by a.attname)) as md5 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace join pg_catalog.pg_attribute a on a.attrelid = c.oid where n.nspname in ('public', 'app') and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped group by 1 order by 1;

-- F13 the migration ledger as the database holds it: count, highest, and a hash of the names.
select count(*) as applied, max(name) as highest, md5(string_agg(name, '|' order by name)) as md5 from app.schema_migrations;

-- F15 table privileges by role: how many tables of public and app each role holds each privilege on (explains a difference in F04).
select coalesce(r.rolname, 'public') as role, count(*) filter (where a.privilege_type = 'SELECT') as sel, count(*) filter (where a.privilege_type = 'INSERT') as ins, count(*) filter (where a.privilege_type = 'UPDATE') as upd, count(*) filter (where a.privilege_type = 'DELETE') as del, count(*) filter (where a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as other from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace cross join lateral pg_catalog.aclexplode(c.relacl) a left join pg_catalog.pg_roles r on r.oid = a.grantee where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v') group by 1 order by 1;

-- F16 tables of public and app WITHOUT row security, and what the browser-facing roles can do on them (names of tables only; no rows).
select n.nspname || '.' || c.relname as t, c.relrowsecurity as rls, has_table_privilege('anon', c.oid, 'SELECT') as anon_select, has_table_privilege('anon', c.oid, 'INSERT') as anon_insert, has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select, has_table_privilege('authenticated', c.oid, 'INSERT') as auth_insert from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'app') and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1;

-- F17 relations in public that the browser-facing roles can read or write, split by whether row security protects them (counts).
select c.relkind::text as kind, c.relrowsecurity as rls, count(*) filter (where has_table_privilege('anon', c.oid, 'SELECT')) as anon_can_select, count(*) filter (where has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')) as anon_can_write, count(*) as relations from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p', 'v') group by 1, 2 order by 1, 2;

-- F18 the views in public: owner, whether the view runs with the caller's rights (security_invoker) and whether the browser-facing roles may select it (names only; no rows).
select c.relname as view_name, pg_catalog.pg_get_userbyid(c.relowner) as owner, coalesce(c.reloptions::text, '(none)') as options, has_table_privilege('anon', c.oid, 'SELECT') as anon_select, has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' order by 1;

-- F14 estimated live rows for representative tables (statistics, no scan of the table): used only to say how far production has moved past a backup.
select relname as t, n_live_tup as est_rows from pg_catalog.pg_stat_user_tables where schemaname = 'public' and relname in ('jobs', 'deliveries', 'events', 'documents', 'document_chunks', 'tasks', 'outputs', 'blockers', 'inbound_commands', 'inference_usage', 'job_state_transitions', 'projects', 'offices', 'lessons') order by 1;
