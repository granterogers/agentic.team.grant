-- Searching the correspondence with a QUESTION (#172).
--
-- 0432's `app.mail_search` matched the whole query as one substring, which is
-- a search box and not how anybody asks the office anything. "Have we already
-- discussed the harbour lighting with Priya" matches nothing as a phrase and
-- is one of the five questions the Issue names.
--
-- `app.search_documents` already solved this and 0060 has the measurement:
-- 'any', not the default 'all', because ANDing every word of a sentence
-- requires "discussed" and "already" to appear. So the words are split here
-- the same way, and a match on ANY word of four characters or more ranks the
-- message.
--
-- Ranked rather than filtered, because a question has stop words in it and a
-- message matching three of its words is a better answer than one matching
-- one. Subject matches count double: a word in the subject is what the message
-- is ABOUT, and a word in a hundred characters of preview may be a signature.
--
-- The project scope is unchanged and is the point (ADR-0037): with a project,
-- only that project's correspondence as `mail_for_project` derives it.

drop function if exists public.mail_search(text, uuid, integer);
drop function if exists app.mail_search(text, uuid, integer);

create or replace function app.mail_search(
  p_query text, p_project uuid default null, p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with words as (
    select distinct w
      from unnest(
             regexp_split_to_array(lower(coalesce(p_query, '')), '[^a-z0-9]+')
           ) as w
     where length(w) >= 4
       /*
         The function words, which a four-character floor does not remove.

         Driven before it was believed: "have we already discussed the vimeo
         video mapping" ranked "You have a message from Villa Niki" and a
         GitHub Actions notice level with "What''s new with Vimeo", because
         "have" and "message" are four characters long and appear everywhere.
         A stop list is an enumeration, which this repository normally prefers
         a property to -- and the exception is exactly this: the function words
         of English are a closed set that no future feature adds to, which is
         what makes the usual objection not apply.
       */
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
  scored as (
    select m.message_id,
           sum(case when strpos(lower(coalesce(m.subject, '')), words.w) > 0 then 2 else 0 end
             + case when strpos(lower(coalesce(m.excerpt, '')), words.w) > 0 then 1 else 0 end
           )::int as score
      from public.mail_messages m
     cross join words
     where m.vanished_at is null
       and (p_project is null or m.message_id in (select message_id from scope))
     group by m.message_id
    having sum(case when strpos(lower(coalesce(m.subject, '')), words.w) > 0 then 2 else 0 end
             + case when strpos(lower(coalesce(m.excerpt, '')), words.w) > 0 then 1 else 0 end) > 0
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
               'has_attachments', m.has_attachments,
               'score', s.score) as v,
             s.score, m.sent_at as ord
        from scored s
        join public.mail_messages m using (message_id)
       order by s.score desc, m.sent_at desc nulls last
       limit greatest(1, least(100, coalesce(p_limit, 20)))
    ) r;
$function$;

comment on function app.mail_search(text, uuid, integer) is
  'Search the cached mail with a question (#172). Any word of four characters '
  'or more, subject matches worth double, ranked rather than filtered. With a '
  'project, only that project''s correspondence as `mail_for_project` derives '
  'it -- the isolation rule of ADR-0037.';

create or replace function public.mail_search(
  p_query text, p_project uuid default null, p_limit integer default 20)
returns jsonb language sql security definer set search_path to ''
as $function$ select app.mail_search(p_query, p_project, p_limit) $function$;
