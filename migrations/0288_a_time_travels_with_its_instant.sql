-- 0288 — a time travels with its instant
--
-- Issue #153, from #137 item 5.
--
-- "3 days ago", "2 hours ago", "just now" — every one computed in SQL when the
-- payload was built. Before #117 that was harmless, because a page lived for a
-- minute. With the watcher the studio stays open all afternoon and those
-- strings go quietly wrong while Grant is looking at them. A feed saying "2
-- minutes ago" about something from breakfast is worse than one with no times
-- at all: there is nothing to make him doubt it.
--
-- ## What changes here, and what does not
--
-- The rendered string STAYS. Every one of them is what the page falls back to
-- when the instant is missing or unparseable, which is what lets `when.js` be
-- rolled through the projections one at a time instead of in a flag day.
--
-- What is added is the instant beside it, on a `…At` key — following
-- `hq_studio_lately`, which has carried `'at', e.occurred_at` beside its
-- `'when'` since 0221 and is the precedent this copies rather than a new idea.
--
-- ## The other half of the Issue, which is the more valuable one
--
--   > *It also makes every relative time in the product derive from one
--   > function instead of from whichever SQL built that section, which is how
--   > "This week" and "3 days ago" came to disagree in the first place.*
--
-- Three projections rendered a time three different ways: `app.ago` in one,
-- `to_char(…, 'FMDD Mon HH24:MI')` in another, `to_char(…, 'FMDD Mon')` in a
-- third. Once the instant travels, `web/studio/when.js` is the only thing that
-- decides what "recent" means, and the strings here become a fallback rather
-- than the source of the disagreement.
--
-- `hq_build` already emits `since`, `started_at` and `finished_at` raw, so the
-- build feed needs nothing.
--
-- Every function below is patched from `pg_get_functiondef`.

begin;

-- ---------------------------------------------------------------------------
-- The activity feed
-- ---------------------------------------------------------------------------

create or replace function app.studio_activity(p_project_id uuid, p_limit integer default 12)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'who', e.actor,
           'verb', app.action_in_words(e.action_type) ->> 'verb',
           'what', app.action_in_words(e.action_type) ->> 'what',
           'when', to_char(e.occurred_at, 'FMDD Mon HH24:MI'),
           -- #153. The instant, so the words can be re-made in the browser and
           -- the exact date is available on hover. `when` stays as the
           -- fallback for a page that cannot parse this.
           'at', e.occurred_at,
           'detail', e.rationale_summary
         ) order by e.occurred_at desc), '[]'::jsonb)
    from (select * from public.events ee
           where ee.project_id = p_project_id
           order by ee.occurred_at desc
           limit greatest(coalesce(p_limit, 12), 1)) e
$function$;

-- ---------------------------------------------------------------------------
-- When somebody was last spoken to
-- ---------------------------------------------------------------------------
--
-- The one that used `app.ago` and therefore the one that drifts fastest: a
-- contact card reading "3 days ago" at nine in the morning still says it at
-- midnight, and on the following afternoon.

create or replace function app.studio_contacts(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', c.contact_id,
           'name', c.name,
           'kind', c.kind,
           'role', nullif(c.role, ''),
           'org', nullif(c.org, ''),
           'stage', c.stage,
           'email', nullif(c.email, ''),
           'phone', nullif(c.phone, ''),
           'instagram', nullif(c.instagram, ''),
           'website', nullif(c.website, ''),
           'where', nullif(c."where", ''),
           'note', nullif(c.note, ''),
           'next', nullif(c.next, ''),
           'nextDue', nullif(c.next_due, ''),
           -- The card shows "3 days ago". Absent is absent rather than
           -- "never", because a contact nobody has spoken to yet has no last.
           'last', case when c.last_at is null then null else app.ago(c.last_at) end,
           -- #153. And the instant it was rendered from.
           'lastAt', c.last_at,
           -- #110. The ids only: the page already holds the label set, and
           -- repeating a name and a hue on every contact is the same string
           -- twenty times in one payload.
           'labels', coalesce((select jsonb_agg(k.label_id)
                                 from public.contact_label_links k
                                where k.contact_id = c.contact_id), '[]'::jsonb),
           'labelsSet', c.labels_set,
           'fields', c.fields
         )) order by c.name), '[]'::jsonb)
    from public.contacts c
   where c.project_id = p_project_id and not c.is_fixture
$$;

-- ---------------------------------------------------------------------------
-- What was asked for, and when it came back
-- ---------------------------------------------------------------------------
--
-- Patched by adding two keys to the object `studio_requests` already builds.
-- The whole function is restated because that is what `create or replace`
-- requires; nothing else in it changes.

create or replace function app.studio_requests(p_project_id uuid, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', j.job_id,
           'state', case
             when j.state in ('queued', 'running', 'waiting_external',
                              'waiting_user', 'retrying', 'paused') then 'working'
             when j.state = 'complete' and o.output_id is not null
              and coalesce(o.reviewer_status, 'pending') = 'pending' then 'review'
             when j.state = 'complete' then 'approved'
             else 'discarded' end,
           'who', coalesce(j.recipient_agent, 'chief-of-staff'),
           'ask', j.kind,
           'asked', to_char(j.created_at, 'FMDD Mon'),
           'delivered', case when o.created_at is null then ''
                             else to_char(o.created_at, 'FMDD Mon') end,
           -- #153. The instants behind both, so a request made this morning
           -- does not still read as this morning tomorrow.
           'askedAt', j.created_at,
           'deliveredAt', o.created_at,
           /*
             Blocked means blocked (0230), and absent means absent (0232).

             The three states that mean something is being waited on, with the
             reason from `blockers.requested_action` — the same column
             `needs_me` reads. Null here is stripped by the wrapper above, so
             the key is simply not there when nothing is wrong.
           */
           'blocked', case
             when j.state in ('waiting_external', 'waiting_user', 'paused')
               then coalesce(
                 (select bl.requested_action from public.blockers bl
                   where bl.job_id = j.job_id and bl.resolved_at is null
                   order by bl.created_at desc limit 1),
                 nullif(btrim(coalesce(j.state_reason, '')), ''),
                 'waiting')
             else null end,
           'output', case when o.output_id is null then null else jsonb_build_object(
             'title', left(coalesce(
               nullif(btrim(split_part(o.body, E'\n', 1)), ''), j.kind), 80),
             'kind', 'made',
             'size', case
               when length(coalesce(o.body, '')) >= 550
                 then format('%s words', to_char(round(length(o.body) / 5.5), 'FM999G999'))
               else '' end,
             'body', o.body) end
         )) order by j.created_at desc), '[]'::jsonb)
    from (select * from public.jobs jj
           where jj.project_id = p_project_id and not jj.is_fixture
           order by jj.created_at desc
           limit greatest(coalesce(p_limit, 20), 1)) j
    left join lateral (
      select * from public.outputs oo
       where oo.job_id = j.job_id
       order by oo.created_at desc limit 1
    ) o on true
$function$;

commit;
