-- 1026: the free tier is watched on the way to its limit (G-1 of the 6 October 2026 audit).
--
-- The database was recorded at 63 MB on 17 September and 372 MB on 5 October against a 500 MB line; backups are never
-- deleted and share a 1 GB Storage allowance with everything else; and `app.free_tier_headroom()` (0180) was only
-- DISPLAYED. A reading nobody is looking at is not a warning. Nothing in the office said anything on the way to the
-- line, and which of the two allowances is reached first was not knowable from the database, because the database
-- kept no history of its own size.
--
-- WHAT THIS ADDS (and what it deliberately does not)
--
--   1. public.capacity_samples: one append-only row per UTC day per scope, the last reading of the day winning.
--      Scopes: `database`, `storage` (every bucket, backups included), `bucket:<id>`, and `table:<schema.name>` for
--      the largest fifteen relations by pg_total_relation_size. BOUNDED ITSELF: about 20 rows a day, pruned at 180
--      days by the same function that writes it, capped per pass. It stores sizes, never content.
--   2. app.capacity_level / capacity_growth / capacity_days_to_limit: three PURE functions, the SQL twins of
--      src/ops/capacity.ts. scripts/isolated/capacity-warning.ts drives both over the same table of cases and goes
--      red if they ever disagree. Thresholds 70 / 85 / 95 percent of a CONSERVATIVE limit (500 000 000 and
--      1 000 000 000 bytes, decimal: the free tier's "500 MB" is not 500 MiB), with three points of hysteresis so a
--      table hovering at a line does not announce a crossing every few hours.
--   3. app.capacity_sample / capacity_watch: write the day's samples, return the two readings with their level, the
--      level before this reading, and the projected days to the limit at the FASTEST recent rate (3, 7 and 28 day
--      windows; the maximum, so a quiet week does not erase a bad month).
--   4. app.chores_for_capacity: a chore on each operator's list per resource and level (`capacity:<scope>:<level>`),
--      raised on the crossing and cleared by the same pass when the level falls, exactly the shape of
--      app.chores_for_backups (0537). It is delegated to from app.chores_for_credentials, which the DEPLOYED
--      office.chores handler already calls every hour, so it runs without a worker deploy (0540's argument: a
--      migration is not a deploy, and a warning that works and is not running is worth nothing).
--   5. A duty, `capacity-watch`, every six hours on the system office, for the handler in
--      src/handlers/capacity-watch.ts. The handler composes the notice IN CODE and says it only through
--      app.say_once, keyed on a topic that changes on a crossing and on nothing else: a crossing speaks at once and an
--      unchanged level at most once in twenty hours. It runs when that worker is deployed; until then the chore is the
--      warning.
--   6. app.free_tier_headroom() gains a `growth` key (additive; every existing key is unchanged), so the page that
--      already shows the headroom also shows the level and the projected days.
--
-- WHAT IT DOES NOT DO: delete anything. Retention is analysed in docs/ops/capacity-scenarios-2026-10-06.md and decided
-- by Grant; this migration only measures.
--
-- No begin/commit: the runner applies a file as one all-or-nothing unit (SqlExecutor's atomicity contract).

-- ---------------------------------------------------------------------------------------------------- the samples

create table if not exists public.capacity_samples (
  sampled_on date        not null,
  scope      text        not null check (scope ~ '^(database|storage|bucket:.+|table:.+)$'),
  bytes      bigint      not null check (bytes >= 0),
  level      smallint    not null default 0 check (level between 0 and 3),
  sampled_at timestamptz not null default app.now_utc(),
  primary key (sampled_on, scope)
);

comment on table public.capacity_samples is
  'One size reading per UTC day per scope (database, storage, bucket:<id>, table:<schema.name>), the last of the day '
  'winning. Sizes only, never content. Bounded: pruned at 180 days by app.capacity_sample. The history '
  'app.free_tier_headroom could not give a projection without (G-1).';
comment on column public.capacity_samples.level is
  'The warning level (0 to 3) in force after this reading, with hysteresis. Only database and storage carry one.';

alter table public.capacity_samples enable row level security;

create index if not exists capacity_samples_scope_idx on public.capacity_samples (scope, sampled_on desc);

-- ------------------------------------------------------------------------------------------------ the pure twins

create or replace function app.capacity_level(p_percent numeric, p_previous integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    (p_percent >= 70)::int + (p_percent >= 85)::int + (p_percent >= 95)::int,
    least(coalesce(p_previous, 0),
          ((p_percent + 3) >= 70)::int + ((p_percent + 3) >= 85)::int + ((p_percent + 3) >= 95)::int)
  )
$$;

comment on function app.capacity_level(numeric, integer) is
  'The warning level after a reading: 70 / 85 / 95 percent, up at once, down only after three points of clearance. '
  'SQL twin of levelFor in src/ops/capacity.ts; scripts/isolated/capacity-warning.ts compares them.';

-- The fastest recent growth as an exact fraction (bytes gained, days spanned), or no row when nothing grew.
create or replace function app.capacity_growth(p_days date[], p_bytes bigint[])
returns table (delta bigint, span integer)
language sql
immutable
set search_path = ''
as $$
  with pts as (
    select distinct on (t.d) t.d, t.b
      from unnest(p_days, p_bytes) with ordinality as t(d, b, ord)
     order by t.d, t.ord desc
  ), last as (
    select d, b from pts order by d desc limit 1
  ), cand as (
    select l.b - f.b as delta, l.d - f.d as span
      from last l
     cross join unnest(array[3, 7, 28]) as w(win)
     cross join lateral (
       select p.d, p.b from pts p where p.d >= l.d - w.win and p.d < l.d order by p.d limit 1
     ) f
  )
  select c.delta, c.span from cand c where c.delta > 0
   order by c.delta::numeric / c.span desc limit 1
$$;

create or replace function app.capacity_days_to_limit(p_days date[], p_bytes bigint[], p_limit bigint)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_cur bigint;
  g record;
begin
  select t.b into v_cur
    from (select distinct on (u.d) u.d, u.b
            from unnest(p_days, p_bytes) with ordinality as u(d, b, ord)
           order by u.d, u.ord desc) t
   order by t.d desc limit 1;
  if v_cur is null then return null; end if;
  if v_cur >= p_limit then return 0; end if;
  select * into g from app.capacity_growth(p_days, p_bytes);
  if g.delta is null then return null; end if;
  return ((p_limit - v_cur) * g.span / g.delta)::integer;
end
$$;

comment on function app.capacity_days_to_limit(date[], bigint[], bigint) is
  'Whole days until the limit at the fastest 3 / 7 / 28 day rate; 0 at or past it; null when nothing is growing or '
  'there is no data. Integer arithmetic throughout. SQL twin of daysToLimit in src/ops/capacity.ts.';

-- ----------------------------------------------------------------------------------------------- the reading

-- One resource, read-only: the live bytes against the history. STABLE and never writes, so the display function
-- (app.free_tier_headroom) can call it.
create or replace function app.capacity_reading(p_scope text, p_live bigint, p_limit bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days date[];
  v_bytes bigint[];
  v_prev integer;
  v_today date := (app.now_utc() at time zone 'utc')::date;
  v_percent numeric := round(100.0 * p_live / p_limit, 2);
begin
  select coalesce(array_agg(s.sampled_on order by s.sampled_on), '{}'),
         coalesce(array_agg(s.bytes order by s.sampled_on), '{}')
    into v_days, v_bytes
    from public.capacity_samples s
   where s.scope = p_scope and s.sampled_on >= v_today - 40 and s.sampled_on < v_today;
  -- today's value is the LIVE reading, appended last so it wins over any earlier sample of the day
  v_days := v_days || v_today;
  v_bytes := v_bytes || p_live;

  select s.level into v_prev from public.capacity_samples s
   where s.scope = p_scope order by s.sampled_on desc limit 1;

  return jsonb_build_object(
    'scope', p_scope,
    'bytes', p_live,
    'limit_bytes', p_limit,
    'percent', v_percent,
    'level', app.capacity_level(v_percent, coalesce(v_prev, 0)),
    'previous_level', coalesce(v_prev, 0),
    'days_to_limit', app.capacity_days_to_limit(v_days, v_bytes, p_limit),
    'samples', cardinality(v_days) - 1
  );
end
$$;

-- ------------------------------------------------------------------------------------------------ the sampling

create or replace function app.capacity_sample()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (app.now_utc() at time zone 'utc')::date;
  v_db bigint;
  v_storage bigint;
  r record;
  v_prev smallint;
  v_level smallint;
  v_levels jsonb := '{}'::jsonb;
  v_pruned integer;
begin
  select pg_catalog.pg_database_size(pg_catalog.current_database()) into v_db;
  -- the byte count lives in the metadata the storage API writes (0180); an object with none counts zero
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0) into v_storage from storage.objects o;

  for r in
    select * from (values ('database', v_db, 500000000::bigint),
                          ('storage', v_storage, 1000000000::bigint)) as t(scope, bytes, lim)
  loop
    select s.level into v_prev from public.capacity_samples s
     where s.scope = r.scope order by s.sampled_on desc limit 1;
    v_level := app.capacity_level(100.0 * r.bytes / r.lim, coalesce(v_prev, 0));
    insert into public.capacity_samples (sampled_on, scope, bytes, level)
    values (v_day, r.scope, r.bytes, v_level)
    on conflict (sampled_on, scope) do update
      set bytes = excluded.bytes, level = excluded.level, sampled_at = app.now_utc();
    v_levels := v_levels || jsonb_build_object(r.scope, jsonb_build_object(
      'previous_level', coalesce(v_prev, 0), 'level', v_level));
  end loop;

  insert into public.capacity_samples (sampled_on, scope, bytes)
  select v_day, 'bucket:' || o.bucket_id, sum(coalesce((o.metadata ->> 'size')::bigint, 0))
    from storage.objects o where o.bucket_id is not null group by o.bucket_id
  on conflict (sampled_on, scope) do update set bytes = excluded.bytes, sampled_at = app.now_utc();

  insert into public.capacity_samples (sampled_on, scope, bytes)
  select v_day, 'table:' || n.nspname || '.' || c.relname, pg_catalog.pg_total_relation_size(c.oid)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p')
     and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg\_%'
   order by pg_catalog.pg_total_relation_size(c.oid) desc
   limit 15
  on conflict (sampled_on, scope) do update set bytes = excluded.bytes, sampled_at = app.now_utc();

  -- bounded itself: a history older than 180 days is not a projection input, and the cap keeps a backlog from
  -- becoming one long delete
  with old as (
    select s.sampled_on, s.scope from public.capacity_samples s
     where s.sampled_on < v_day - 180 order by s.sampled_on limit 2000
  )
  delete from public.capacity_samples s using old
   where s.sampled_on = old.sampled_on and s.scope = old.scope;
  get diagnostics v_pruned = row_count;

  return jsonb_build_object('sampled_on', v_day, 'levels', v_levels, 'pruned', v_pruned);
end
$$;

comment on function app.capacity_sample() is
  'Write today''s size readings (database, storage, each bucket, the fifteen largest relations) and the warning level '
  'with hysteresis; prune the history past 180 days. Idempotent within a day. Measures only: it deletes nothing but '
  'its own old samples.';

create or replace function app.capacity_watch()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sampled jsonb := app.capacity_sample();
  v_day date := (app.now_utc() at time zone 'utc')::date;
  v_db jsonb;
  v_st jsonb;
  v_largest jsonb;
  v_backups bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('table', substr(s.scope, 7), 'bytes', s.bytes) order by s.bytes desc), '[]')
    into v_largest
    from (select scope, bytes from public.capacity_samples
           where sampled_on = v_day and scope like 'table:%' order by bytes desc limit 5) s;
  select s.bytes into v_backups from public.capacity_samples s where s.sampled_on = v_day and s.scope = 'bucket:backups';

  v_db := app.capacity_reading('database',
            (select bytes from public.capacity_samples where sampled_on = v_day and scope = 'database'), 500000000);
  v_st := app.capacity_reading('storage',
            (select bytes from public.capacity_samples where sampled_on = v_day and scope = 'storage'), 1000000000);

  -- `previous_level` is the level BEFORE this reading, from the sampling call, not the one just written
  v_db := v_db || jsonb_build_object('previous_level', coalesce((v_sampled #>> '{levels,database,previous_level}')::int, 0),
                                     'largest', v_largest);
  v_st := v_st || jsonb_build_object('previous_level', coalesce((v_sampled #>> '{levels,storage,previous_level}')::int, 0),
                                     'backups_bytes', coalesce(v_backups, 0));

  return jsonb_build_object('sampled_on', v_day, 'readings', jsonb_build_array(v_db, v_st));
end
$$;

comment on function app.capacity_watch() is
  'Sample, then return the database and storage readings: bytes, conservative limit, percent, level, the level before '
  'this reading, projected days to the limit, and the five largest tables. The handler composes the notice from this '
  'in code; this function says nothing in words.';

-- ------------------------------------------------------------------------------------------------- the chore

create or replace function app.chores_for_capacity()
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  w jsonb;
  r jsonb;
  o uuid;
  v_scope text;
  v_level integer;
  v_key text;
  v_raised int := 0;
  v_cleared int := 0;
  v_about text[] := '{}';
  v_label text;
begin
  w := app.capacity_watch();
  for o in select * from app.operator_offices() loop
    for r in select * from jsonb_array_elements(w -> 'readings') loop
      v_scope := r ->> 'scope';
      v_level := (r ->> 'level')::int;
      v_key := format('capacity:%s:%s', v_scope, v_level);
      v_label := case v_scope when 'database' then 'the database' else 'file storage (backups included)' end;

      -- Any chore of this resource at a DIFFERENT level is finished: a level that rose has a new chore below, and a
      -- level that fell has none. Cleared by the pass that raises, because a list that never empties is one he stops
      -- trusting (0484).
      update public.tasks
         set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
       where office_id = o and chore_key like format('capacity:%s:%%', v_scope)
         and chore_key <> v_key and state <> 'done';
      if found then v_cleared := v_cleared + 1; end if;

      if v_level > 0 then
        insert into public.tasks
          (office_id, project_id, title, detail, state, priority, assigned_to_human, added_by, labels, chore_key)
        values (o, null,
                format('%s is at %s%% of its free-tier line (warning level %s of 3)',
                       initcap(v_label), round((r ->> 'percent')::numeric), v_level),
                left(format('%s MB of %s MB (conservative, decimal). %s Nothing has been deleted. '
                            'Read docs/ops/capacity-scenarios-2026-10-06.md for what can safely be removed and '
                            'npm run qq -- "select jsonb_pretty(app.free_tier_headroom())" for the live figures.',
                            round((r ->> 'bytes')::numeric / 1000000), round((r ->> 'limit_bytes')::numeric / 1000000),
                            case when r ->> 'days_to_limit' is null
                                 then 'It is not growing at the moment.'
                                 else format('At the fastest recent rate it is full in about %s days.', r ->> 'days_to_limit')
                            end), 2000),
                'todo', case when v_level >= 3 then 10 else 20 end, true, 'the office', array['capacity'], v_key)
        on conflict do nothing;
        if found then
          v_raised := v_raised + 1;
          v_about := v_about || v_key;
        end if;
      else
        update public.tasks
           set state = 'done', done_at = app.now_utc(), updated_at = app.now_utc()
         where office_id = o and chore_key = v_key and state <> 'done';
      end if;
    end loop;
  end loop;

  return jsonb_build_object('raised', v_raised, 'cleared', v_cleared, 'about', to_jsonb(v_about));
end
$function$;

comment on function app.chores_for_capacity() is
  'Raise a chore per resource and warning level (capacity:<scope>:<level>) on each operator list, clear the ones '
  'that no longer apply in the same pass. One open chore per key by the unique index, so a persistent condition is '
  'one row and not one a pass. Delegated to from app.chores_for_credentials so it runs without a worker deploy.';

-- ------------------------------------------------------------ chores_for_credentials, spliced from the live body

do $splice$
declare
  v_def text := pg_get_functiondef('app.chores_for_credentials()'::regprocedure);
  v_anchor text := E'  return jsonb_build_object(''raised'', v_raised, ''cleared'', v_cleared,\n                            ''about'', to_jsonb(v_names),\n                            ''backup'', v_backup);';
  v_new text;
begin
  if position('app.chores_for_backups()' in v_def) = 0 or position(v_anchor in v_def) = 0 then
    -- a no-op that looks like success is worse than a refusal (0538's rule)
    raise exception 'app.chores_for_credentials has changed since 1026 was written; re-splice from the live definition';
  end if;
  if position('app.chores_for_capacity()' in v_def) > 0 then
    return;
  end if;
  v_new := replace(v_def, v_anchor, $new$  -- 1026. The capacity pass, beside the backup pass and for the same reason: the handler that would call it
  -- directly is not deployed, and this one is. Never fatal and never silent.
  begin
    v_capacity := app.chores_for_capacity();
  exception when others then
    v_capacity := jsonb_build_object('error', left(sqlerrm, 200));
  end;

  return jsonb_build_object('raised', v_raised, 'cleared', v_cleared,
                            'about', to_jsonb(v_names),
                            'backup', v_backup,
                            'capacity', v_capacity);$new$);
  v_new := replace(v_new, E'  v_backup jsonb;\nbegin', E'  v_backup jsonb;\n  v_capacity jsonb;\nbegin');
  if position('v_capacity jsonb;' in v_new) = 0 then
    raise exception 'splice of app.chores_for_credentials did not land the declaration';
  end if;
  execute v_new;
end
$splice$;

-- -------------------------------------------------------------------- free_tier_headroom, spliced from live

do $splice$
declare
  v_def text := pg_get_functiondef('app.free_tier_headroom()'::regprocedure);
  v_anchor text := E'    ''measured_at'', app.now_utc()\n  );';
  v_new text;
begin
  if position(v_anchor in v_def) = 0 then
    raise exception 'app.free_tier_headroom has changed since 1026 was written; re-splice from the live definition';
  end if;
  if position('''growth''' in v_def) > 0 then
    return;
  end if;
  v_new := replace(v_def, v_anchor, $new$    'growth', jsonb_build_object(
      'database', app.capacity_reading('database', db_bytes, 500000000),
      'storage', app.capacity_reading('storage', storage_bytes, 1000000000),
      'note', 'Warning levels use the conservative decimal limits (500 MB, 1 GB), not the 500 MiB / 1 GiB ' ||
              'the percent keys above use. days_to_limit is at the fastest 3, 7 or 28 day rate; null means ' ||
              'no growth or no history yet.'
    ),
    'measured_at', app.now_utc()
  );$new$);
  execute v_new;
end
$splice$;

-- -------------------------------------------------------------------------------------------------- the duty

insert into public.responsibilities (slug, staff_id, description, job_kind, period_minutes, office_id)
select 'capacity-watch', s.staff_id,
       'Sample the size of the database, of file storage and of the largest tables, project the days to the free-tier '
       'limits, and say so once when a warning level is crossed (70, 85, 95 percent) and at most daily afterwards. '
       'Measures and tells; deletes nothing (G-1).',
       'office.capacity_watch', 360, (select o.office_id from public.offices o where o.kind = 'system')
  from public.staff s
 where s.slug = 'operations-director'
on conflict (office_id, slug) do nothing;
