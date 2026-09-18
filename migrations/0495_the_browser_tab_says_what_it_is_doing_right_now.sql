/*
  What the office is doing on a site RIGHT NOW, and how to stop it (#135, #16).

  #135 asks, in Grant's own words, for a browser he can SEE — and names four
  things the tab must answer: what it is doing right now, live, with a Stop
  that works; and anything paused waiting for him.

  The tab could answer neither. `browser_sessions_for` lists sites, and
  `browser_lately` lists what ALREADY happened — both are past tense. A gather
  that is running this second appeared nowhere on the surface built to show
  browsing, and the only Stop in the product is on the jobs list, which is a
  different screen reached a different way and says nothing about which site is
  being read.

  So this is the present tense: the browsing jobs that are live for a project,
  what each is reading, how long it has been going, whether a stop has already
  been asked for, and whether it is parked waiting for a person.

  ## Why it reads jobs rather than the ledger

  `browser_actions` is append-only and written when a step FINISHES. A row
  appears there after the fact by construction, so a reader built on it can
  never say "now" — it would show the last thing that completed and call it
  current, which is worse than showing nothing because it looks live.

  ## The harness filter is the same one, deliberately

  `app.harness_browsing` already decides what may appear on this tab, and 0443
  exists because a suite polluted it. A second predicate here would be a second
  place for that answer to rot (0310's rule), so this asks the same function.

  No backticks in any comment in this file.
*/

create or replace function app.browser_now(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(jsonb_agg(x.v order by x.ord), '[]'::jsonb) from (
    select row_number() over (order by j.created_at) as ord,
           jsonb_build_object(
             'job_id', j.job_id,
             'url', j.pinned_config ->> 'url',
             'state', j.state::text,
             /*
               Parked waiting for a person is a different thing from running,
               and #16 asks for it as its own clear action. Said as a boolean
               rather than left for the page to work out from the state name,
               because two surfaces deciding that separately is how they come
               to disagree.
             */
             'waiting_for_you', (j.state in ('waiting_user', 'paused')),
             'stop_asked', (j.stop_requested_at is not null),
             'since', j.created_at,
             'site', s.site
           ) as v
      from public.jobs j
      left join public.browser_sessions s
        on s.project_id = j.project_id
       and s.site = lower(split_part(split_part(
             regexp_replace(coalesce(j.pinned_config ->> 'url', ''), '^https?://', ''),
             '/', 1), ':', 1))
     where j.kind = 'browser.gather'
       and j.project_id = p_project
       and j.state in ('queued', 'running', 'retrying', 'waiting_user', 'paused')
       and not app.harness_browsing(j.job_id, j.project_id)
     order by j.created_at
     limit 20
  ) x;
$fn$;

comment on function app.browser_now(uuid) is
  'The browsing the office is doing for this project right now, so the Browser '
  'tab can answer "what is it doing" in the present tense and offer a Stop '
  'beside it (#135, #16).';

/* PostgREST only exposes public, so the tab needs a wrapper to reach it. */
create or replace function public.browser_now(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$ select app.browser_now(p_project) $function$;

/*
  Driven here rather than only declared, because a migration that applies
  cleanly is not a function that works — 0390 declared four defects in one
  feature and every one of them would have surfaced weeks later as a press
  that did nothing.
*/
do $drive$
declare
  v_project uuid;
  v_job uuid;
  v_now jsonb;
begin
  insert into public.projects (name, slug, status)
  values ('fixture browser now probe', 'fixture-browser-now-probe', 'active')
  returning project_id into v_project;

  insert into public.jobs (kind, state, project_id, requested_by, correlation_id, idempotency_key, pinned_config)
  values ('browser.gather', 'running', v_project, 'teamhq:grant',
          gen_random_uuid(), 'browser-now-probe-' || gen_random_uuid()::text,
          jsonb_build_object('url', 'https://supplier.example.com/orders'))
  returning job_id into v_job;

  v_now := app.browser_now(v_project);

  /*
    The project is a fixture, so the harness filter must hide it. That is the
    assertion AND the control for it in one: if the filter were missing this
    would be 1, and if the reader were broken it would also be 0 -- so the
    second half below removes the fixture-ness and demands the row back.

    The job is deliberately requested_by 'teamhq:grant' rather than a verify
    name. 0342 gave jobs.is_fixture a '%:verify-%' branch, so a harness-shaped
    requester would make BOTH halves of app.harness_browsing true and the
    second assertion could never pass however the project were renamed -- which
    is exactly what the first run of this probe did. The project branch is the
    one under test here; the job branch has its own coverage in verify:browser.
  */
  if jsonb_array_length(v_now) <> 0 then
    raise exception 'browser_now showed harness traffic: %', v_now;
  end if;

  update public.projects set slug = 'browser-now-probe-real' where project_id = v_project;
  v_now := app.browser_now(v_project);
  if jsonb_array_length(v_now) <> 1 then
    raise exception 'browser_now found nothing for a real project: %', v_now;
  end if;
  if (v_now -> 0 ->> 'url') <> 'https://supplier.example.com/orders' then
    raise exception 'browser_now lost the url: %', v_now;
  end if;
  if (v_now -> 0 ->> 'stop_asked') <> 'false' then
    raise exception 'browser_now claimed a stop nobody asked for: %', v_now;
  end if;

  update public.jobs set stop_requested_at = app.now_utc() where job_id = v_job;
  v_now := app.browser_now(v_project);
  if (v_now -> 0 ->> 'stop_asked') <> 'true' then
    raise exception 'browser_now did not notice the stop request: %', v_now;
  end if;

  raise notice 'browser_now: hidden for a fixture, found for a real project, stop seen';
  raise exception 'rolling the probe back';
exception
  when others then
    if sqlerrm <> 'rolling the probe back' then raise; end if;
end
$drive$;
