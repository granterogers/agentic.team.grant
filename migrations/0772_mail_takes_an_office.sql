-- 0772 - mail takes an office (multi-user P3, cluster g-context).
--
-- Mail is the most personal corpus the office holds. mail_messages carries office_id; the readers below read
-- `m.office_id = p_office` IN the statement that fetches the rows, and a contact matched to a message must be a
-- contact of a project of the same office (contacts hang off projects, and the project is resolved inside the office
-- first). A project of another office behaves exactly like one that does not exist: every reader answers as it does
-- for an unknown project (nothing).
--
--   app.mail_for_project / mail_search / mail_awaiting / mail_coverage (office, ...)
--   app.forget_mail_before / forget_mail_bodies_before (office, days)   retention is per office: it deletes only that
--                                                                        office's messages, so one person's clean-up can
--                                                                        never age out another person's mail.
--
-- Note for the lead: the retention duty (handlers/mail.ts) now sweeps the office of the job it runs under. A second
-- office gets its sweep when it has its own retention duty; until then its mail is simply not aged out (the safe
-- direction), never swept by somebody else's.
--
-- The public doors (public.mail_for_project, mail_search, mail_awaiting, mail_coverage) are dropped; nothing in the
-- gateway or the edge functions reaches them.

create function app.mail_for_project(p_office uuid, p_project uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with live as (
    select p.project_id
      from public.projects p
     where p.office_id = app.require_office(p_office)
       and p.project_id = p_project
       and p.status = 'active'
       and not p.is_fixture
  ),
  by_contact as (
    select m.message_id,
           'contact'::text as tier,
           coalesce(nullif(btrim(c.name), ''), c.email) as matched
      from public.mail_messages m
      join public.contacts c
        on lower(btrim(c.email)) = lower(btrim(coalesce(m.from_address, '')))
      join live on live.project_id = c.project_id
     where m.office_id = p_office
       and m.vanished_at is null
       and coalesce(btrim(c.email), '') <> ''
  ),
  by_alias as (
    select m.message_id,
           'named'::text as tier,
           a.alias as matched
      from public.mail_messages m
      join public.project_aliases a on true
      join live on live.project_id = a.project_id
     where m.office_id = p_office
       and m.vanished_at is null
       and length(a.normalised) >= 4
       and strpos(
             ' ' || regexp_replace(lower(coalesce(m.subject, '')), '[^a-z0-9]+', ' ', 'g') || ' ',
             ' ' || btrim(regexp_replace(lower(a.normalised), '[^a-z0-9]+', ' ', 'g')) || ' '
           ) > 0
  ),
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
               /*
                 Bounded here rather than at the caller. The reader returns up
                 to 100 rows and a prompt has a character budget; a caller that
                 has to remember to truncate is a caller that will forget once.
               */
               'body', left(m.body, 1500),
               'body_truncated', coalesce(length(m.body), 0) > 1500,
               'body_withheld', m.body_withheld,
               'has_attachments', m.has_attachments,
               'why', b.tier,
               'matched', b.matched) as v,
             m.sent_at as ord
        from best b
        join public.mail_messages m using (message_id)
       where m.office_id = p_office
         and b.rank = 1
       order by m.sent_at desc nulls last
       limit greatest(1, least(100, coalesce(p_limit, 20)))
    ) q;
$function$;

revoke all on function app.mail_for_project(uuid, uuid, integer) from public, anon, authenticated, service_role;

create function app.mail_awaiting(p_office uuid, p_project uuid, p_days integer DEFAULT 7, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with claimed as (
    -- The messages this project can see, by ADR-0037's derivation, unchanged.
    select (x->>'thread_id') as thread_id,
           (x->>'why') as why
      from jsonb_array_elements(app.mail_for_project(p_office, p_project, 200)) as x
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
      join public.mail_messages m on m.thread_id = t.thread_id and m.office_id = p_office
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
$function$;

revoke all on function app.mail_awaiting(uuid, uuid, integer, integer) from public, anon, authenticated, service_role;

create function app.mail_search(p_office uuid, p_query text, p_project uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with words as (
    select distinct w
      from unnest(
             regexp_split_to_array(lower(coalesce(p_query, '')), '[^a-z0-9]+')
           ) as w
     where length(w) >= 4
       and w not in (
         'have', 'has', 'been', 'that', 'this', 'with', 'from', 'what', 'when',
         'where', 'which', 'about', 'there', 'their', 'they', 'them', 'were',
         'will', 'would', 'could', 'should', 'your', 'yours', 'ours', 'into',
         'over', 'under', 'then', 'than', 'also', 'just', 'some', 'any', 'all',
         'more', 'most', 'much', 'very', 'said', 'says', 'tell', 'told', 'know',
         'anything', 'something', 'already', 'please', 'thanks', 'regarding',
         'message', 'messages', 'email', 'emails', 'mail', 'inbox',
         'discussed', 'discuss', 'talked', 'talking'
       )
  ),
  scope as (
    select jsonb_array_elements(app.mail_for_project(p_office, p_project, 100)) ->> 'message_id' as message_id
     where p_project is not null
  ),
  /*
    The body scores 1, the same as the snippet and half the subject.

    Not more, deliberately. A body is thirty times longer than a snippet, so a
    word that appears in it once is much weaker evidence than the same word in
    a subject line -- and scoring by presence rather than by count is what
    stops the longest thread in the inbox winning every search.
  */
  scored as (
    select m.message_id,
           sum(case when strpos(lower(coalesce(m.subject, '')), words.w) > 0 then 2 else 0 end
             + case when strpos(lower(coalesce(m.excerpt, '')), words.w) > 0 then 1 else 0 end
             + case when strpos(lower(coalesce(m.body, '')), words.w) > 0 then 1 else 0 end
           )::int as score
      from public.mail_messages m
     cross join words
     where m.office_id = app.require_office(p_office)
       and m.vanished_at is null
       and (p_project is null or m.message_id in (select message_id from scope))
     group by m.message_id
    having sum(case when strpos(lower(coalesce(m.subject, '')), words.w) > 0 then 2 else 0 end
             + case when strpos(lower(coalesce(m.excerpt, '')), words.w) > 0 then 1 else 0 end
             + case when strpos(lower(coalesce(m.body, '')), words.w) > 0 then 1 else 0 end) > 0
  )
  select coalesce(jsonb_agg(v order by score desc, ord desc nulls last), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'message_id', m.message_id,
               'thread_id', m.thread_id,
               'subject', coalesce(nullif(btrim(coalesce(m.subject, '')), ''), '(no subject)'),
               'from', coalesce(nullif(btrim(coalesce(m.from_name, '')), ''), m.from_address, 'unknown'),
               'from_address', m.from_address,
               'sent_at', m.sent_at,
               'excerpt', m.excerpt,
               'body', left(m.body, 1500),
               'body_truncated', coalesce(length(m.body), 0) > 1500,
               'body_withheld', m.body_withheld,
               'has_attachments', m.has_attachments,
               'score', s.score) as v,
             s.score, m.sent_at as ord
        from scored s
        join public.mail_messages m using (message_id)
       where m.office_id = p_office
       order by s.score desc, m.sent_at desc nulls last
       limit greatest(1, least(100, coalesce(p_limit, 20)))
    ) r;
$function$;

revoke all on function app.mail_search(uuid, text, uuid, integer) from public, anon, authenticated, service_role;

create function app.mail_coverage(p_office uuid, p_project uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    /* How much mail the office holds at all, across every project. */
    'cached', (select count(*)::int from public.mail_messages where office_id = app.require_office(p_office)),
    /* The newest thing it holds, so a stale cache is visible as staleness. */
    'newest', (select max(sent_at) from public.mail_messages where office_id = p_office),
    /*
      The two ways a message can reach a project, counted. Zero contacts is
      the fact that matters: it means the strongest tier cannot fire at all,
      which is a completely different sentence from "nothing matched".
    */
    'contacts', (
      select count(*)::int from public.contacts c
       where p_project is not null and c.project_id = app.office_project(p_office, p_project)
    ),
    'aliases', (
      select count(*)::int from public.project_aliases a
       where p_project is not null and a.project_id = app.office_project(p_office, p_project)
    ),
    'associated', (
      select jsonb_array_length(app.mail_for_project(p_office, p_project, 200))
       where p_project is not null
    )
  );
$function$;

revoke all on function app.mail_coverage(uuid, uuid) from public, anon, authenticated, service_role;

create function app.forget_mail_before(p_office uuid, p_days integer DEFAULT 180)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_cut timestamptz; v_gone integer;
begin
  perform app.require_office(p_office);
  if coalesce(p_days, 0) < 30 then
    return jsonb_build_object('ok', false,
      'error', 'a retention shorter than 30 days would drop mail the office is still answering from');
  end if;
  v_cut := app.now_utc() - make_interval(days => p_days);
  delete from public.mail_messages where office_id = p_office and sent_at is not null and sent_at < v_cut;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'removed', v_gone, 'before', v_cut);
end;
$function$;

revoke all on function app.forget_mail_before(uuid, integer) from public, anon, authenticated, service_role;

create function app.forget_mail_bodies_before(p_office uuid, p_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_cut timestamptz; v_gone integer;
begin
  perform app.require_office(p_office);
  if coalesce(p_days, 0) < 7 then
    return jsonb_build_object('ok', false,
      'error', 'a body retention shorter than 7 days would drop correspondence mid-conversation');
  end if;
  v_cut := app.now_utc() - make_interval(days => p_days);
  update public.mail_messages
     set body = null,
         body_at = null,
         /*
           Not 'bulk' and not 'no text part' -- both would be false. A body the
           office aged out is a fourth state, and saying one of the other three
           is how a reader comes to report a deliberate withholding as a fact
           about the message.
         */
         body_withheld = null
   where office_id = p_office
     and body is not null
     and body_at < v_cut;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'forgotten', v_gone, 'before', v_cut);
end;
$function$;

revoke all on function app.forget_mail_bodies_before(uuid, integer) from public, anon, authenticated, service_role;


drop function app.mail_for_project(uuid, integer);
drop function app.mail_awaiting(uuid, integer, integer);
drop function app.mail_search(text, uuid, integer);
drop function app.mail_coverage(uuid);
drop function app.forget_mail_before(integer);
drop function app.forget_mail_bodies_before(integer);
drop function public.mail_for_project(uuid, integer);
drop function public.mail_awaiting(uuid, integer, integer);
drop function public.mail_search(text, uuid, integer);
drop function public.mail_coverage(uuid);
