/*
  A gate that is red BY DESIGN teaches people to skip it.

  0523 made a production destination structurally unreachable from a harness
  job. Two deliveries got out before it, at 21:09 on 21 September, and #298
  established exactly why: `verify:history` drives `app.enqueue_inbound` on
  purpose, so `requested_by` was `telegram:grant` when `claim_delivery` asked,
  and the suite corrected its attribution in teardown TWENTY SECONDS after the
  message was already on Grant's phone. The guard was not bypassed; it was
  asked the right question at a moment when the answer was still "real".

  #298 deliberately left those two rows in place, because deleting them
  destroys the record of the defect. The consequence is that `check:leaks`
  has exited 1 ever since, permanently, on evidence somebody chose to keep --
  and it cost exactly what CLAUDE.md says a check that cries wolf costs: a
  fresh session read the red exit as a live containment failure and filed a
  duplicate issue (#323).

  ## Acknowledged, never suppressed

  The distinction the gate needs is between "2 known, 0 new" and "1 new", and
  it must not be obtainable by rewriting history. So:

    * the rows stay exactly as they are -- nothing here touches `deliveries`;
    * an acknowledgement is PER DELIVERY ID, so it can never pre-approve an
      escape that has not happened yet;
    * it carries the issue and the reason, because a baseline entry with no
      reason is an admission (CLAUDE.md, twice, about `check:callers` and
      `check:pressable`);
    * a foreign key means you cannot acknowledge a delivery that does not
      exist, and `on delete cascade` means the acknowledgement cannot outlive
      its subject.

  What this deliberately does NOT do is let anybody acknowledge by pattern,
  by suite name or by date range. Every one of those would silence the next
  escape as well, which is the only thing this gate exists to catch.
*/

create table if not exists public.known_escapes (
  delivery_id  uuid primary key references public.deliveries(delivery_id) on delete cascade,
  issue        text        not null,
  why          text        not null,
  acknowledged_at timestamptz not null default app.now_utc(),
  constraint known_escapes_has_an_issue check (btrim(issue) <> ''),
  constraint known_escapes_has_a_reason check (length(btrim(why)) >= 20)
);

comment on table public.known_escapes is
  'Harness deliveries that reached a real destination, investigated and kept as evidence. '
  'Acknowledged one delivery_id at a time so that no future escape can be silenced in advance.';

/*
  The two from #298, by id. Named individually on purpose -- see above.
*/
insert into public.known_escapes (delivery_id, issue, why)
values
  ('7ff55c4a-3154-47b1-876b-50926963050d', '#298',
   'verify:history corrected its attribution in teardown, twenty seconds after the send; '
   'claim_delivery was asked while the job still looked real. Kept as the record of the defect.'),
  ('edc47073-5f7a-495f-9e4a-9af6a66ea912', '#298',
   'verify:history corrected its attribution in teardown, twenty seconds after the send; '
   'claim_delivery was asked while the job still looked real. Kept as the record of the defect.')
on conflict (delivery_id) do nothing;

/*
  And the reader says which is which.

  `escaped` is kept, unchanged, so nothing reading the old key breaks and the
  total stays visible -- CLAUDE.md's rule about two words for one thing cuts
  the other way here: the honest report is the WHOLE number and its split,
  not a smaller number that looks better.
*/
create or replace function app.harness_escapes()
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
as $function$
  with out as (
    select d.delivery_id, d.channel, d.target_ref, d.sent_at, j.requested_by,
           k.issue, k.why
      from public.deliveries d
      join public.jobs j on j.job_id = d.job_id
      left join public.known_escapes k on k.delivery_id = d.delivery_id
     where app.harness_job(d.job_id)
       and d.sent_at is not null
       and d.created_at > app.harness_guard_since()
  )
  select jsonb_build_object(
    'since', app.harness_guard_since(),
    'escaped', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', o.channel, 'target', o.target_ref,
               'by', o.requested_by, 'at', o.sent_at,
               'known', o.issue is not null, 'issue', o.issue)
               order by o.sent_at desc) from out o), '[]'::jsonb),
    'known', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', o.channel, 'target', o.target_ref,
               'by', o.requested_by, 'at', o.sent_at,
               'issue', o.issue, 'why', o.why)
               order by o.sent_at desc) from out o where o.issue is not null), '[]'::jsonb),
    'new', coalesce((
      select jsonb_agg(jsonb_build_object(
               'channel', o.channel, 'target', o.target_ref,
               'by', o.requested_by, 'at', o.sent_at)
               order by o.sent_at desc) from out o where o.issue is null), '[]'::jsonb),
    'refused', coalesce((
      select count(*)::int from public.deliveries d
       where app.harness_job(d.job_id)
         and d.state = 'suppressed'
         and d.suppressed_reason like '%production destination%'
         and d.created_at > app.harness_guard_since()), 0),
    'before_the_guard', coalesce((
      select count(*)::int from public.deliveries d
       where app.harness_job(d.job_id) and d.sent_at is not null
         and d.created_at <= app.harness_guard_since()), 0))
$function$;
