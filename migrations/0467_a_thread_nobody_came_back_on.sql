-- The half of "outstanding commitments" that metadata can honestly answer (#172).
--
-- Grant named the hardest question on the Issue himself:
--
--   > Are there outstanding commitments I have forgotten?
--
-- and called it the most valuable. Most of it cannot be answered from what
-- this office holds, and saying so is better than approximating it:
-- `src/google/mail.ts` fetches `format=metadata`, so there are NO message
-- bodies anywhere. A commitment extractor over subject lines and
-- hundred-character snippets would be a model guessing, and #237 is a long
-- record of what guessing costs when the answer is about Grant's own business.
--
-- What IS a fact, with no bodies and no inference, is the SHAPE of a thread:
--
--   * he wrote, and in the days since, nothing has come back;
--   * somebody wrote to him in a thread he had been part of, and he has not
--     replied.
--
-- Neither is a commitment. Both are the thing a person means when they ask the
-- question, and both are checkable: `thread_id`, who the last message was
-- from, and when. The cache holds 133 threads today, 10 of them with a SENT
-- message, so the signal exists in real data rather than in principle.
--
-- ## It reuses the project derivation rather than restating it
--
-- ADR-0037 decided that a message belongs to a project by DERIVATION, in two
-- tiers that are never merged, and `verify:mail` holds that with six negative
-- controls -- an excerpt match claims nothing, an alias under four characters
-- claims nothing, a phrase inside a longer word claims nothing, one project
-- cannot see another's correspondence. A second derivation here would be a
-- second thing to get wrong, and the controls would not cover it. So this
-- calls `app.mail_for_project` and reasons about the threads it returns.
--
-- That also inherits the rule that matters most: **there is no cross-project
-- reader**. A question about what is outstanding is asked of one project.
--
-- ## What it refuses to call outstanding
--
-- A newsletter nobody replied to is not a forgotten commitment, and an office
-- that said so every morning would be one Grant stops reading. Gmail's own
-- categories are the filter -- `CATEGORY_PROMOTIONS` and `CATEGORY_UPDATES`
-- are Google's classification of exactly this, already on the row, and
-- better than a word list this repository would have to maintain.
--
-- A thread also has to be OLD enough to be worth mentioning. Two days is not
-- forgotten; the default is seven, and it is an argument rather than a
-- constant so a caller can ask a different question.

create or replace function app.mail_awaiting(
  p_project uuid,
  p_days integer default 7,
  p_limit integer default 10)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with mine as (
    -- Everything this project can see, by ADR-0037's derivation. 200 rather
    -- than the reader's default 20: a thread's LAST message is the one that
    -- matters and a small window would cut threads in half.
    select (x->>'message_id') as message_id,
           (x->>'thread_id') as thread_id,
           (x->>'why') as why
      from jsonb_array_elements(app.mail_for_project(p_project, 200)) as x
  ),
  msgs as (
    select m.*, mine.why
      from mine
      join public.mail_messages m using (message_id)
     where m.vanished_at is null
       -- Google's own classification of "this is not correspondence".
       and not ('CATEGORY_PROMOTIONS' = any (coalesce(m.labels, '{}')))
       and not ('CATEGORY_UPDATES' = any (coalesce(m.labels, '{}')))
  ),
  /*
    One row per thread, describing its LAST message.

    `distinct on` rather than a window function because the question is only
    ever about the latest: a thread is waiting on whoever did not speak last.
  */
  last_in_thread as (
    select distinct on (thread_id)
           thread_id, message_id, subject, from_name, from_address, sent_at, why,
           ('SENT' = any (coalesce(labels, '{}'))) as from_grant
      from msgs
     order by thread_id, sent_at desc nulls last
  )
  select coalesce(jsonb_agg(v order by ord), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'thread_id', t.thread_id,
               'subject', coalesce(nullif(btrim(coalesce(t.subject, '')), ''), '(no subject)'),
               'with', coalesce(nullif(btrim(coalesce(t.from_name, '')), ''),
                                t.from_address, 'unknown'),
               'last_at', t.sent_at,
               'days', floor(extract(epoch from (app.now_utc() - t.sent_at)) / 86400)::int,
               /*
                 WHICH WAY it is waiting, never a single "outstanding" flag.

                 "You wrote and nobody came back" and "they wrote and you have
                 not replied" need completely different things from Grant, and
                 0304's lesson is that collapsing two signals into one boolean
                 is how the weaker one starts being read as the stronger.
               */
               'waiting', case when t.from_grant then 'no reply to you'
                               else 'you have not replied' end,
               -- Inherited from the derivation, so an answer can say whether
               -- the project association was a fact or an inference.
               'why', t.why) as v,
             t.sent_at as ord
        from last_in_thread t
       where t.sent_at is not null
         and t.sent_at < app.now_utc() - make_interval(days => greatest(1, coalesce(p_days, 7)))
       order by t.sent_at asc
       limit greatest(1, least(50, coalesce(p_limit, 10)))
    ) q;
$fn$;

comment on function app.mail_awaiting(uuid, integer, integer) is
  'Threads on one project where nobody has spoken for a while, and which way round '
  '(#172). Derived from ADR-0037''s project association and from thread shape alone: '
  'there are no message bodies in this system, so this reports what is CHECKABLE and '
  'never guesses at a commitment.';

create or replace function public.mail_awaiting(
  p_project uuid, p_days integer default 7, p_limit integer default 10)
returns jsonb language sql stable security definer set search_path to ''
as $w$ select app.mail_awaiting(p_project, p_days, p_limit) $w$;
