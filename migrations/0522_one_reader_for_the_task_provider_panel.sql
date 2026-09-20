/*
  0522 — one reader for the task provider panel (#259, Phase 2)

  `check:callers` went red on `public.hq_forget_vikunja` and
  `public.task_sync_trouble`: two capabilities nobody could reach, which is
  #72's whole complaint and was true — the connect and disconnect existed and
  the Connections page had no idea. A wrapper is reachable only through
  PostgREST, so "only a suite names it" means only a suite can use it.

  The panel needs two facts at once — is it connected, and is anything in
  disagreement — so it gets ONE reader rather than two sections, for the reason
  the row-list-built-twice trap gives: two calls that must agree about the same
  screen will eventually disagree.

  `public.task_sync_trouble` is dropped rather than kept for later. CLAUDE.md's
  order is to drop the WRAPPER first and let the check say whether the function
  underneath is dead; `app.task_sync_trouble` stays, and the panel is its
  caller.
*/

drop function if exists public.task_sync_trouble(text);

create or replace function app.task_sync_panel()
returns jsonb language sql stable security definer set search_path = '' as $f$
  select app.vikunja_settings() || jsonb_build_object(
    'trouble', app.task_sync_trouble('vikunja'),
    /*
      What it is keeping in step, so "connected" is a number rather than a
      claim. A panel that says connected over an empty mapping is the dead-dial
      shape one layer up.
    */
    'linked', (select count(*)::int from public.task_links l
                join public.tasks t on t.task_id = l.task_id
               where l.provider = 'vikunja' and not coalesce(t.is_fixture, false)),
    'last_synced', (select max(greatest(coalesce(pushed_at, 'epoch'::timestamptz),
                                        coalesce(pulled_at, 'epoch'::timestamptz)))
                      from public.task_links where provider = 'vikunja'))
$f$;

grant execute on function app.task_sync_panel() to authenticated, service_role;

create or replace function public.task_sync_panel()
returns jsonb language sql security definer set search_path = '' as $w$
  select app.task_sync_panel()
$w$;

grant execute on function public.task_sync_panel() to authenticated, service_role;

do $drive$
declare v jsonb;
begin
  v := app.task_sync_panel();
  if v ->> 'configured' is null then
    raise exception '0522: the panel does not say whether anything is connected: %', v;
  end if;
  if jsonb_typeof(v -> 'trouble') <> 'array' then
    raise exception '0522: trouble is not a list: %', v;
  end if;
  if (v ->> 'linked')::int is null then
    raise exception '0522: the panel cannot say how many tasks are mapped: %', v;
  end if;
  /* Nothing is connected in this database, so it must say so rather than 1. */
  if (v ->> 'configured')::boolean is not false then
    raise exception '0522: it reports itself connected when nothing is: %', v;
  end if;
  raise notice '0522 drive: four checks passed';
end;
$drive$;
