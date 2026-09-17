-- Mail joins the coverage the office reports honestly (#172, ADR-0037).
--
-- 0427 taught `project_knowledge` to name every connector attached with
-- nothing indexed, so the office could stop reporting an unindexed connector
-- as an absence. 0432 gave a project its correspondence. This is the join
-- between the two: mail is a domain the office can be BLIND to, and an answer
-- that searched the mail and found nothing is only evidence of an absence when
-- the cache is current.
--
-- It is not hypothetical. Google is refusing the stored refresh token
-- (`invalid_grant`, `connection_health` says so as of this morning) and the
-- mail cache is 40 hours old. The duty runs hourly and succeeds as a JOB every
-- time, so nothing anywhere was saying the office had stopped reading the
-- mail.
--
-- Built by splicing `pg_get_functiondef` rather than transcribing 60 lines to
-- change three -- and terminated with the semicolon that function omits, which
-- 0353 and 0355 each cost a run to learn.

CREATE OR REPLACE FUNCTION app.project_knowledge(p_project uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with attached as (
    select a.connector,
           count(*)::int as attachments,
           max(a.last_synced_at) as last_synced
      from public.project_attachments a
     where a.project_id = p_project
       and a.enabled
     group by a.connector
  ),
  indexed as (
    select d.connector,
           count(*)::int as documents,
           max(coalesce(d.fetched_at, d.updated_at)) as newest
      from public.documents d
     where d.project_id = p_project
       and coalesce(btrim(d.connector), '') <> ''
     group by d.connector
  ),
  /*
    Every connector that is attached OR has fed something in.

    Named `covered` rather than `both`, which is a reserved word — `trim(both
    ...)` — and produced a syntax error pointing at the CTE name.

    A full outer join rather than a left one: a connector whose attachment was
    removed can still have documents (§17 turns off a route, not what it
    brought in), and a reader that hid those would be understating what the
    office holds -- the opposite failure to the one this exists for, and just
    as dishonest.
  */
  covered as (
    select coalesce(a.connector, i.connector) as connector,
           coalesce(a.attachments, 0) as attachments,
           a.last_synced,
           coalesce(i.documents, 0) as documents,
           i.newest
      from attached a
      full outer join indexed i on i.connector = a.connector
  ),
  /*
    Mail as a domain the office can be blind to (#172, ADR-0037).

    Narrowed to a project that has at least one CONTACT with an address, and
    deliberately not to one that merely has an alias: almost every project has
    a name of four characters or more, so the wider rule would put a caveat on
    every answer the office gives whenever Gmail is down -- and CLAUDE.md
    already records what a caveat on every turn costs. A contact is Grant
    saying this project has correspondents, which is what makes the gap worth
    reporting.

    Stale rather than empty. An inbox with nothing new in it is normal; a cache
    that has not been refreshed in a day means the reader is broken, which is
    the case today -- Google is refusing the stored refresh token and the mail
    has been 40 hours old without anything saying so.
  */
  mail as (
    select exists (
             select 1 from public.contacts c
              where c.project_id = p_project
                and coalesce(btrim(c.email), '') <> ''
           )
           and coalesce(
                 (select max(m.last_seen_at) from public.mail_messages m),
                 'epoch'::timestamptz
               ) < app.now_utc() - interval '24 hours' as blind
  )
  select jsonb_build_object(
    'as_of', app.now_utc(),
    'documents', (select coalesce(sum(documents), 0)::int from covered),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'connector', b.connector,
               'attached', b.attachments > 0,
               'documents', b.documents,
               'newest', b.newest,
               'last_synced', b.last_synced,
               -- Attached, and nothing of it is in the index. The case this
               -- function exists for.
               'blank', b.attachments > 0 and b.documents = 0)
             order by b.documents desc, b.connector)
        from covered b), '[]'::jsonb),
    /*
      The connectors a search CANNOT speak for.

      Named rather than counted, because the sentence the office has to be able
      to say is "nothing in what I have indexed, and Drive is not indexed" --
      and a count cannot name Drive.
    */
    'blank', coalesce((
      select jsonb_agg(x order by x) from (
        select b.connector as x from covered b where b.attachments > 0 and b.documents = 0
        union all
        select 'mail' from mail where mail.blind
      ) named), '[]'::jsonb),
    -- True only when every attached connector has fed something in. A search
    -- that finds nothing may be reported as an absence ONLY when this is true.
    'complete', not exists (
      select 1 from covered b where b.attachments > 0 and b.documents = 0)
      and not (select mail.blind from mail)
  );
$function$;
