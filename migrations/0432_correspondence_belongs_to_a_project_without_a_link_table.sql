-- The correspondence becomes part of the project record (#172, ADR-0037).
--
-- `google.read_mail` has cached Grant's inbox hourly since 0127 and nothing
-- has ever connected a message to a dashboard project. So the office holds 164
-- messages and cannot answer "is there anything in my email about this
-- project" -- the reach exists, the cache exists, and the association does
-- not.
--
-- ## Why nothing here stores the association
--
-- ADR-0037 has the full argument. The short version is that neither table the
-- Issue names can hold it -- `project_attachments` is one row per CONNECTOR
-- and `relations` endpoints are uuids of typed rows, while a message is keyed
-- by Gmail's text id -- and widening both would be inventing the third linking
-- model with two existing tables' names on it.
--
-- So it is DERIVED, from two things Grant already curates: a contact he put on
-- the project, and the alias phrases that already route his instructions. 0310
-- is the precedent: do not store a fact you can already read, because the copy
-- is the one that rots.
--
-- ## The three narrowings, which are the difference between a feature and a leak
--
--   1. the SUBJECT only, never the excerpt -- an excerpt is a hundred
--      characters of quoted signature and unsubscribe footer, and matching
--      there is how a personal email arrives under a work project;
--   2. a whole phrase of at least four characters, so a short alias cannot
--      claim the inbox;
--   3. active, non-fixture projects only -- there are 1,102 alias rows across
--      917 projects and almost all of those projects are retired probes.
--
-- Whole-word matching is done by normalising both sides to single-spaced
-- alphanumerics and padding with spaces, rather than by a regex: the alias
-- would otherwise have to be escaped for both regex metacharacters and LIKE
-- wildcards, and an escape written once is an escape that will be wrong.

create or replace function app.mail_for_project(p_project uuid, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with live as (
    select p.project_id
      from public.projects p
     where p.project_id = p_project
       and p.status = 'active'
       and not p.is_fixture
  ),
  /*
    The strong tier. Grant put this person on this project himself, which is
    the clearest statement of relevance the database holds.
  */
  by_contact as (
    select m.message_id,
           'contact'::text as tier,
           coalesce(nullif(btrim(c.name), ''), c.email) as matched
      from public.mail_messages m
      join public.contacts c
        on lower(btrim(c.email)) = lower(btrim(coalesce(m.from_address, '')))
      join live on live.project_id = c.project_id
     where m.vanished_at is null
       and coalesce(btrim(c.email), '') <> ''
  ),
  /*
    The inferred tier. The same vocabulary that routes his instructions,
    matched whole against the subject.
  */
  by_alias as (
    select m.message_id,
           'named'::text as tier,
           a.alias as matched
      from public.mail_messages m
      join public.project_aliases a on true
      join live on live.project_id = a.project_id
     where m.vanished_at is null
       and length(a.normalised) >= 4
       and strpos(
             ' ' || regexp_replace(lower(coalesce(m.subject, '')), '[^a-z0-9]+', ' ', 'g') || ' ',
             ' ' || btrim(regexp_replace(lower(a.normalised), '[^a-z0-9]+', ' ', 'g')) || ' '
           ) > 0
  ),
  /*
    A message can match both ways and must appear once. `contact` wins, because
    the two tiers are never merged and an answer built on the weaker one should
    be able to say so -- 0304's asymmetry, in a column.
  */
  best as (
    select message_id, tier, matched,
           row_number() over (
             partition by message_id
             order by case tier when 'contact' then 0 else 1 end, matched) as rank
      from (select * from by_contact union all select * from by_alias) both_tiers
  )
  select coalesce(jsonb_agg(v order by ord), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'message_id', m.message_id,
               'thread_id', m.thread_id,
               'subject', coalesce(nullif(btrim(coalesce(m.subject, '')), ''), '(no subject)'),
               'from', coalesce(nullif(btrim(coalesce(m.from_name, '')), ''), m.from_address, 'unknown'),
               'from_address', m.from_address,
               'sent_at', m.sent_at,
               'excerpt', m.excerpt,
               'has_attachments', m.has_attachments,
               -- Stated, never inferred. A contact match is a fact and a
               -- subject match is an inference.
               'why', b.tier,
               'matched', b.matched) as v,
             m.sent_at as ord
        from best b
        join public.mail_messages m using (message_id)
       where b.rank = 1
       order by m.sent_at desc nulls last
       limit greatest(1, least(100, coalesce(p_limit, 20)))
    ) q;
$function$;

comment on function app.mail_for_project(uuid, integer) is
  'The correspondence that belongs to a dashboard project (#172, ADR-0037). '
  'Derived from a contact on the project or an alias phrase in the SUBJECT -- '
  'never stored, never matched on the excerpt. `why` names which tier, and the '
  'two are deliberately not merged.';

/*
  Searching it, within one project or across the inbox.

  The project-scoped call is what an AGENT uses: a question about one project
  may only see that project's correspondence, which is the isolation ADR-0037
  is mostly about. The unscoped call is Grant asking about his own inbox
  through his own channel, which is the question `app.mail_recent` already
  answers and this narrows by words.
*/
create or replace function app.mail_search(
  p_query text, p_project uuid default null, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with asked as (
    select btrim(coalesce(p_query, '')) as q
  ),
  scope as (
    select jsonb_array_elements(app.mail_for_project(p_project, 100)) ->> 'message_id' as message_id
     where p_project is not null
  )
  select coalesce(jsonb_agg(v order by ord desc nulls last), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'message_id', m.message_id,
               'thread_id', m.thread_id,
               'subject', coalesce(nullif(btrim(coalesce(m.subject, '')), ''), '(no subject)'),
               'from', coalesce(nullif(btrim(coalesce(m.from_name, '')), ''), m.from_address, 'unknown'),
               'from_address', m.from_address,
               'sent_at', m.sent_at,
               'excerpt', m.excerpt,
               'has_attachments', m.has_attachments) as v,
             m.sent_at as ord
        from public.mail_messages m, asked
       where m.vanished_at is null
         and asked.q <> ''
         and (p_project is null or m.message_id in (select message_id from scope))
         and (lower(coalesce(m.subject, '')) like '%' || lower(asked.q) || '%'
              or lower(coalesce(m.excerpt, '')) like '%' || lower(asked.q) || '%')
       order by m.sent_at desc nulls last
       limit greatest(1, least(100, coalesce(p_limit, 20)))
    ) r;
$function$;

comment on function app.mail_search(text, uuid, integer) is
  'Search the cached mail (#172). With a project, only that project'' s '
  'correspondence as `mail_for_project` derives it -- the isolation rule of '
  'ADR-0037. Without one, the whole cache, which is Grant asking about his own '
  'inbox.';

/*
  A cache nobody decided to keep for ever.

  `mail_messages` has never been pruned. The refresh caps at fifty a run and
  marks what left the window `vanished_at`, so it grows slowly -- and a table
  holding Grant''s subject lines indefinitely is not something anybody chose.
  180 days is long enough for "have we already discussed this" and short enough
  to be a limit rather than an archive (ADR-0037).

  Returns what it removed, because a delete keyed on something nobody checked
  deletes nothing and reports success -- 0350''s Telegram branch is the entry
  in CLAUDE.md that this signature exists to avoid repeating.
*/
create or replace function app.forget_mail_before(p_days integer default 180)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare v_cut timestamptz; v_gone integer;
begin
  if coalesce(p_days, 0) < 30 then
    return jsonb_build_object('ok', false,
      'error', 'a retention shorter than 30 days would drop mail the office is still answering from');
  end if;
  v_cut := app.now_utc() - make_interval(days => p_days);
  delete from public.mail_messages where sent_at is not null and sent_at < v_cut;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'removed', v_gone, 'before', v_cut);
end;
$function$;

create or replace function public.mail_for_project(p_project uuid, p_limit integer default 20)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.mail_for_project(p_project, p_limit) $function$;

create or replace function public.mail_search(
  p_query text, p_project uuid default null, p_limit integer default 20)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.mail_search(p_query, p_project, p_limit) $function$;
