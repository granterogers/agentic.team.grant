-- 0467 could not see "you wrote and nobody came back" (#172).
--
-- Driving it rather than reading it found this in one run. Four threads were
-- set up and three behaved: a recent one was correctly quiet, a promotion was
-- correctly ignored, and "they wrote and you have not replied" came back with
-- the right days and the right tier. The fourth -- Grant writing twice and
-- nothing coming back -- was invisible.
--
-- The cause is in the derivation and it is structural. ADR-0037 associates a
-- MESSAGE with a project by who sent it (a contact on that project) or by what
-- its subject says (an alias of that project). Grant's own sent mail matches
-- neither: he is not a contact on his own projects, and his replies inherit a
-- subject only if the original had the alias in it. **His half of every
-- conversation is invisible to the project**, which is fine for "what has come
-- in" and fatal for "what am I waiting on".
--
-- ## The fix is the thread, and only here
--
-- A thread is ONE conversation. If any message in it belongs to the project,
-- the thread does -- which is a transitive step over `thread_id` rather than a
-- new way of associating anything, so ADR-0037's decision stands and nothing
-- gains a link table.
--
-- Deliberately NOT applied to `app.mail_for_project`. That reader feeds the
-- model on every turn, and widening it to whole threads would disclose more
-- of the inbox for a benefit that reader does not need -- the excerpt of a
-- reply says little that the message it answers did not. `verify:mail`'s six
-- negative controls are written against that reader's exact scope, and a
-- widening that slipped past them is the shape this file exists to avoid.
--
-- Here the thread IS the unit of the question, so the closure is the answer
-- rather than a convenience.

create or replace function app.mail_awaiting(
  p_project uuid,
  p_days integer default 7,
  p_limit integer default 10)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with claimed as (
    -- The messages this project can see, by ADR-0037's derivation, unchanged.
    select (x->>'thread_id') as thread_id,
           (x->>'why') as why
      from jsonb_array_elements(app.mail_for_project(p_project, 200)) as x
  ),
  /*
    One reason per thread, and `contact` wins.

    A thread can contain a contact match and an alias match; the tier reported
    has to be the strongest one in it, for the same reason the message-level
    reader picks the stronger of two tiers rather than merging them.
  */
  threads as (
    select thread_id,
           case when bool_or(why = 'contact') then 'contact' else 'named' end as why
      from claimed
     where thread_id is not null
     group by thread_id
  ),
  /*
    Every message in those threads, including the ones Grant sent.

    This is the step 0467 was missing. It widens nothing about WHICH threads
    the project can see -- that is still ADR-0037's derivation, above -- only
    which messages of an already-claimed thread are considered when deciding
    who spoke last.
  */
  msgs as (
    select m.*, t.why
      from threads t
      join public.mail_messages m on m.thread_id = t.thread_id
     where m.vanished_at is null
       and not ('CATEGORY_PROMOTIONS' = any (coalesce(m.labels, '{}')))
       and not ('CATEGORY_UPDATES' = any (coalesce(m.labels, '{}')))
  ),
  last_in_thread as (
    select distinct on (thread_id)
           thread_id, message_id, subject, from_name, from_address, sent_at, why,
           ('SENT' = any (coalesce(labels, '{}'))) as from_grant
      from msgs
     order by thread_id, sent_at desc nulls last
  ),
  /*
    Who the thread is WITH, which is never Grant.

    The last message decides the direction; it is the wrong place to get the
    other person's name from, because on a thread he spoke last on it would
    read "waiting on Grant Rogers". The counterpart is the most recent sender
    in the thread who is not him.
  */
  counterpart as (
    select distinct on (thread_id) thread_id,
           coalesce(nullif(btrim(coalesce(from_name, '')), ''), from_address, 'unknown') as who
      from msgs
     where not ('SENT' = any (coalesce(labels, '{}')))
     order by thread_id, sent_at desc nulls last
  )
  select coalesce(jsonb_agg(v order by ord), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'thread_id', t.thread_id,
               'subject', coalesce(nullif(btrim(coalesce(t.subject, '')), ''), '(no subject)'),
               'with', coalesce(c.who, 'unknown'),
               'last_at', t.sent_at,
               'days', floor(extract(epoch from (app.now_utc() - t.sent_at)) / 86400)::int,
               -- Which way round, never one "outstanding" flag: the two need
               -- completely different things from him (0304's asymmetry).
               'waiting', case when t.from_grant then 'no reply to you'
                               else 'you have not replied' end,
               'why', t.why) as v,
             t.sent_at as ord
        from last_in_thread t
        left join counterpart c using (thread_id)
       where t.sent_at is not null
         and t.sent_at < app.now_utc() - make_interval(days => greatest(1, coalesce(p_days, 7)))
       order by t.sent_at asc
       limit greatest(1, least(50, coalesce(p_limit, 10)))
    ) q;
$fn$;
