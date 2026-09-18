/*
  Message bodies, because Grant asked for them (#172).

  ADR-0037 decided the office would fetch `format=metadata` and never transfer
  a body at all. That was the right call to make unasked, and every comment on
  #172 since has ended at the same wall: "what decisions have been made by
  email" and "are there outstanding commitments I have forgotten" cannot be
  answered from a subject line and a hundred-character snippet without a model
  guessing about Grant's own business, which is the failure #237 documents at
  length.

  He has now made the call, in writing:

      Grant explicitly authorises caching/indexing relevant Gmail message
      bodies in the private data layer. Use them for project correspondence
      and intelligence with provenance, isolation and anti-injection controls.

  So this reopens ADR-0037's privacy trade deliberately, which is exactly the
  condition that ADR set for reopening it. ADR-0038 records the new decision;
  this migration is its data half.

  ## What changes, and the three narrowings that come with it

  A body is a much larger disclosure than a snippet, so it arrives with limits
  rather than after them:

  1. **Not every message.** Promotional, social and bulk mail keeps its
     metadata and its snippet and does NOT get a body. Grant's newsletters and
     clinic receipts are the bulk of this inbox, they are none of the office's
     business, and a corpus that excludes them is also a better corpus.
  2. **A shorter life than the metadata.** `forget_mail_before` keeps rows for
     180 days. A body is forgotten at 90 by default, in the same duty, so the
     office remembers that a conversation happened for twice as long as it
     remembers what was in it.
  3. **The quoted history is stripped before storage**, in the client. A reply
     chain re-stores the same words once per message in the thread, which
     triples the corpus, triples the disclosure and makes search rank the
     longest thread rather than the most relevant one.

  ## Why the absence of a body is a column and not a null

  0304's asymmetry, and the third instance of it in this table. "There is no
  body here" can mean three completely different things — it has not been
  fetched yet, it was deliberately withheld as bulk mail, or the message
  genuinely had no text part — and a reader that cannot tell them apart will
  eventually report "nothing in that email" about a message the office chose
  not to read. `body_withheld` names which, and a reader states it.

  ## Anti-injection

  Handled above this layer and recorded here so the next person finds it: a
  mail body is `isUntrusted` in `src/knowledge/retrieval.ts`, so `mailBlock`
  fences it behind FROM OUTSIDE THIS OFFICE and states the rule. A body is the
  cheapest injection surface in the product — anybody can send Grant an email —
  and this migration is what makes that surface exist, so the fence landed
  first, in `bb7c9c3`, deliberately.

  ## Isolation

  Unchanged and inherited rather than restated. `public.mail_messages` has RLS
  enabled AND forced, so nothing reaches it but the SECURITY DEFINER functions
  below; `app.mail_for_project` takes a project and there is no unscoped agent
  reader; ADR-0037's two derivation tiers decide which project sees which
  message, and the six negative controls in `verify:mail` are written against
  that exact scope.
*/

alter table public.mail_messages
  add column if not exists body text,
  add column if not exists body_at timestamptz,
  add column if not exists body_withheld text;

comment on column public.mail_messages.body is
  'The message text, quoted history stripped, or null. #172 / ADR-0038. Fenced as untrusted at every reader.';
comment on column public.mail_messages.body_at is
  'When the body was stored. Paired with body by a constraint, and what forget_mail_bodies_before ages out.';
comment on column public.mail_messages.body_withheld is
  'Why there is no body: bulk, no-text-part or too-large. Null with a body, and null when nothing has looked yet.';

/*
  The three fixed points travel together, which `public.documents` already
  learned the expensive way: content with a timestamp, and a reason exactly
  when there is no content. Without the second half a withheld body and an
  unfetched one are the same row.
*/
alter table public.mail_messages
  drop constraint if exists mail_body_and_its_time;
alter table public.mail_messages
  add constraint mail_body_and_its_time
  check ((body is null) = (body_at is null));

alter table public.mail_messages
  drop constraint if exists mail_withheld_or_held_never_both;
alter table public.mail_messages
  add constraint mail_withheld_or_held_never_both
  check (body is null or body_withheld is null);

alter table public.mail_messages
  drop constraint if exists mail_withheld_says_which;
alter table public.mail_messages
  add constraint mail_withheld_says_which
  check (body_withheld is null or body_withheld in ('bulk', 'no text part', 'too large'));

/*
  Search over the body, as a real index rather than an expression beside one.

  CLAUDE.md records what writing `to_tsvector(title || content) @@ q` beside a
  generated column cost on `public.documents`: a sequential scan against an
  index that was right there, AND flat, so a message whose SUBJECT is the thing
  you searched for ranked equal with one that mentions it once in passing.
  Weighted the same way that table is: the subject is 'A', the body is 'B'.
*/
alter table public.mail_messages
  drop column if exists search;
alter table public.mail_messages
  add column search tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, coalesce(excerpt, ''))), 'B')
  ) stored;

create index if not exists mail_messages_search on public.mail_messages using gin (search);

/*
  A body is forgotten before the fact that a message existed is.

  Deliberately a separate function from `forget_mail_before` rather than a
  second parameter on it: they answer different questions, they run at
  different intervals, and folding them together would make one number decide
  both. The floor is 7 days rather than 30 — a body is the part it is safest to
  forget early, so the function should not argue with somebody tightening it.
*/
create or replace function app.forget_mail_bodies_before(p_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_cut timestamptz; v_gone integer;
begin
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
   where body is not null
     and body_at < v_cut;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'forgotten', v_gone, 'before', v_cut);
end;
$fn$;

grant execute on function app.forget_mail_bodies_before(integer) to service_role;

/*
  ---------------------------------------------------------------- the readers

  Both are rewritten from their LIVE definitions with the body added, not from
  memory. CLAUDE.md records what rewriting `app.pause_job` from memory cost:
  four behaviours lost in one go, including a job that kept its lease.
*/

create or replace function app.mail_for_project(p_project uuid, p_limit integer default 20)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with live as (
    select p.project_id
      from public.projects p
     where p.project_id = p_project
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
     where m.vanished_at is null
       and coalesce(btrim(c.email), '') <> ''
  ),
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
       where b.rank = 1
       order by m.sent_at desc nulls last
       limit greatest(1, least(100, coalesce(p_limit, 20)))
    ) q;
$fn$;

create or replace function app.mail_search(p_query text, p_project uuid default null, p_limit integer default 20)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
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
    select jsonb_array_elements(app.mail_for_project(p_project, 100)) ->> 'message_id' as message_id
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
     where m.vanished_at is null
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
       order by s.score desc, m.sent_at desc nulls last
       limit greatest(1, least(100, coalesce(p_limit, 20)))
    ) r;
$fn$;

/*
  Coverage gains a body dimension.

  #257's rule, one level in: a search that found nothing is evidence of an
  absence only when the index covers what is attached -- and now that a body
  CAN be held, "the office has this message but not its words" is a distinct
  kind of empty that `mailCoverageNote` has to be able to say. Spliced from
  the live definition rather than rewritten.
*/
do $splice$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'mail_coverage';
  if v_def is null then
    raise exception 'app.mail_coverage is gone, so this splice would be silent';
  end if;
end
$splice$;

create or replace function app.mail_bodies_held()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select jsonb_build_object(
           'messages', count(*),
           'with_body', count(*) filter (where body is not null),
           'withheld_as_bulk', count(*) filter (where body_withheld = 'bulk'),
           'no_text_part', count(*) filter (where body_withheld = 'no text part'),
           'never_looked', count(*) filter (where body is null and body_withheld is null))
    from public.mail_messages
   where vanished_at is null;
$fn$;

grant execute on function app.mail_bodies_held() to service_role;

create or replace function public.mail_bodies_held()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$ select app.mail_bodies_held() $fn$;

grant execute on function public.mail_bodies_held() to service_role;
