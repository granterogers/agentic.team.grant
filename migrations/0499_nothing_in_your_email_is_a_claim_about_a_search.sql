/*
  "There is nothing in your email about that" is a CLAIM (#172, #257).

  `app.mail_for_project` returns nothing for every one of Grant's projects
  today. That is not a defect — the inbox is travel and clinic mail — but the
  office has no way to say WHICH of two very different things is true:

    - I looked and your correspondence genuinely holds nothing on this; or
    - I hold 206 messages and cannot associate ANY of them with this project,
      because association needs a contact on the project (there are none) or a
      subject naming it.

  `mailBlock` returns an empty string when there are no hits, so the model is
  told nothing whatever about mail and any absence it states is a claim about
  a search whose shape it was never given. That is #257's defect exactly —
  *"a search that found nothing is only evidence of an absence when the index
  covers what is attached"* — arriving in the mail domain through the one door
  #257 did not cover.

  It matters most here because of a fact ADR-0037 already records and nothing
  acts on: **public.contacts holds zero rows**, and a contact match is called
  "the strongest statement of relevance the database holds". The strong tier
  has never fired on real data. An office that says "nothing in your email"
  while its strongest signal has no data behind it is confidently wrong.

  This reader states the coverage. It makes no judgement and writes nothing —
  the caveat it feeds is empty when coverage is complete, because a caveat on
  every turn is one nobody reads (the same rule `app.project_knowledge` follows).

  No backticks in any comment in this file.
*/

create or replace function app.mail_coverage(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    /* How much mail the office holds at all, across every project. */
    'cached', (select count(*)::int from public.mail_messages),
    /* The newest thing it holds, so a stale cache is visible as staleness. */
    'newest', (select max(sent_at) from public.mail_messages),
    /*
      The two ways a message can reach a project, counted. Zero contacts is
      the fact that matters: it means the strongest tier cannot fire at all,
      which is a completely different sentence from "nothing matched".
    */
    'contacts', (
      select count(*)::int from public.contacts c
       where p_project is not null and c.project_id = p_project
    ),
    'aliases', (
      select count(*)::int from public.project_aliases a
       where p_project is not null and a.project_id = p_project
    ),
    'associated', (
      select jsonb_array_length(app.mail_for_project(p_project, 200))
       where p_project is not null
    )
  );
$fn$;

comment on function app.mail_coverage(uuid) is
  'What the office can and cannot see in the inbox for this project, so an '
  'empty answer can say which kind of empty it is (#172, #257).';

create or replace function public.mail_coverage(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$ select app.mail_coverage(p_project) $function$;

/*
  Driven, and in both directions: it must report the real cache, and it must
  report zero association where there is none. A reader that answered the same
  thing either way would be the inert kind.
*/
do $drive$
declare
  v_project uuid;
  v_cov jsonb;
  v_cached int;
begin
  select count(*)::int into v_cached from public.mail_messages;

  insert into public.projects (name, slug, status)
  values ('fixture coverage probe', 'fixture-coverage-probe', 'active')
  returning project_id into v_project;

  v_cov := app.mail_coverage(v_project);
  if (v_cov ->> 'cached')::int <> v_cached then
    raise exception 'coverage miscounted the cache: % vs %', v_cov ->> 'cached', v_cached;
  end if;
  if (v_cov ->> 'contacts')::int <> 0 then
    raise exception 'a brand new project already has contacts: %', v_cov;
  end if;
  if (v_cov ->> 'associated')::int <> 0 then
    raise exception 'a brand new project already has mail: %', v_cov;
  end if;

  /*
    The CONTROL. Every number above is zero, and a reader that returned zero
    for everything unconditionally would pass all three. So put a contact on
    the project and demand the count move.
  */
  insert into public.contacts (project_id, name, email, kind)
  values (v_project, 'A probe contact', 'probe@example.com', 'person');
  v_cov := app.mail_coverage(v_project);
  if (v_cov ->> 'contacts')::int <> 1 then
    raise exception 'CONTROL FAILED: the contact count does not move: %', v_cov;
  end if;

  raise notice 'mail coverage: % cached, and the counts are not all hardcoded zero', v_cached;
  raise exception 'rolling the probe back';
exception
  when others then
    if sqlerrm <> 'rolling the probe back' then raise; end if;
end
$drive$;
