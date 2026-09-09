-- Claire can see the place.
--
-- Grant, after the call finally connected: *"the voice doesn't seem to have
-- access to any of the project data.. this is critical. the point is for the
-- voice to access everything .. also need to give instructions, give commands,
-- get feedback, etc.. it should be the true voice of 'claire' fully aware of
-- everything."*
--
-- ## What she had
--
-- One tool, `ask_the_team`, which writes an instruction to `inbound_commands`
-- and answers "I have put that to the team, the answer appears in Slack." That
-- is the right behaviour for work and the wrong behaviour for a question. Asked
-- what projects there are, she either got a canned sentence out of
-- `voice_answer`'s pattern list or delegated the question and promised a Slack
-- message — on a phone call, about a fact that is one select away.
--
-- So from the outside she was a switchboard with a nice voice. He is right that
-- this is critical: a chief of staff who has to file a ticket to find out what
-- her own office is doing is not a chief of staff.
--
-- ## Two functions, because there are two moments
--
-- `voice_state()` is what she knows BEFORE he speaks. It is minted into her
-- session instructions when the call starts, so the answer to "what have we
-- got on" is already in her head and costs no round trip. It is deliberately
-- small — a call is not a dashboard, and a model briefed with forty projects
-- reads out forty projects.
--
-- `voice_lookup(about)` is what she can go and find DURING the call, in one
-- hop, while he waits. It resolves a name the way every other surface resolves
-- one — `app.resolve_project_by_name`, so "the wellness thing" and "Legacy
-- Coaching Course" both land — and otherwise falls back to the state of play.
--
-- ## Why these read directly rather than going through the office
--
-- Because the office is asynchronous by design and a conversation is not.
-- Everything here is a read of canonical state: no decision, no model, no
-- write. §5's rule that adapters may only translate is intact — the writes
-- still go through `enqueue_inbound`, exactly as before, and this adds nothing
-- that can change anything.

begin;

-- ---------------------------------------------------------------------------
-- What she knows when the call starts
-- ---------------------------------------------------------------------------

create or replace function app.voice_state()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'as_of', app.now_utc(),
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', p.name,
               'purpose', left(coalesce(p.purpose, p.description, ''), 200),
               'documents', (select count(*) from public.documents d
                              where d.project_id = p.project_id),
               -- What it is joined up to, in the words he uses for them.
               'connected_to', (select coalesce(string_agg(distinct a.connector, ', '), 'nothing')
                                  from public.project_attachments a
                                 where a.project_id = p.project_id and a.enabled),
               -- `outputs` carries no project of its own: it hangs off the job
               -- that produced it, and the job knows the project.
               'last_output', (select max(o.created_at)
                                 from public.outputs o
                                 join public.jobs j on j.job_id = o.job_id
                                where j.project_id = p.project_id))
             order by p.name), '[]'::jsonb)
        from public.projects p
       where p.status = 'active' and not p.is_fixture
    ),
    'team', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'title', s.title)
             order by s.name), '[]'::jsonb)
        from public.staff s where s.active
    ),
    -- The last day's work, as counts. Enough for "it has been quiet" or "Emma
    -- has been busy" to be TRUE rather than a pleasantry.
    'today', (
      -- `state`, not `status`, and 'complete' rather than 'succeeded'. Read off
      -- the live table rather than remembered.
      select jsonb_build_object(
        'finished', count(*) filter (where j.state = 'complete'),
        'failed', count(*) filter (where j.state = 'failed'),
        'in_flight', count(*) filter (where j.state not in ('complete', 'failed', 'cancelled'))
      )
        from public.jobs j
       where j.created_at > app.now_utc() - interval '24 hours'
    ),
    'waiting_on_grant', (
      -- `needs_me` is the view that already means exactly this, and using it
      -- rather than a second definition is how the call and the dashboard stay
      -- telling him the same thing.
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', left(n.requested_action, 160),
               'why', left(coalesce(n.why_needed, ''), 160),
               'project', pr.name,
               'work_goes_on', n.work_can_continue,
               'since', n.created_at) order by n.created_at), '[]'::jsonb)
        from public.needs_me n
        left join public.projects pr on pr.project_id = n.project_id
    ),
    'latest', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'who', coalesce(s.name, 'the office'),
               'project', pr.name,
               -- The first couple of sentences. A voice session briefed with
               -- six full reports opens the call by reading one out.
               'headline', left(o.body, 220),
               'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
        from (select * from public.outputs order by created_at desc limit 6) o
        left join public.staff s on s.staff_id = o.staff_id
        left join public.jobs j on j.job_id = o.job_id
        left join public.projects pr on pr.project_id = j.project_id
    )
  )
$function$;

comment on function app.voice_state is
  'The state of play, small enough to brief a voice session with. Minted into '
  'Claire''s instructions when a call starts so that "what have we got on" '
  'needs no round trip. Read-only (0167).';

-- ---------------------------------------------------------------------------
-- What she can go and find while he waits
-- ---------------------------------------------------------------------------

create or replace function app.voice_lookup(p_about text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_project uuid;
  v_staff   text;
  v_said    text := coalesce(trim(p_about), '');
begin
  -- A person, first: "what has Emma been up to" is about Emma, and a project
  -- name that happens to contain her name should not win that.
  select s.slug into v_staff
    from public.staff s
   where s.active
     and (v_said ~* ('\m' || s.name || '\M') or v_said ~* ('\m' || s.slug || '\M'))
   order by length(s.name) desc
   limit 1;

  if v_staff is not null then
    return jsonb_build_object(
      'about', 'person',
      'who', (select jsonb_build_object('name', s.name, 'title', s.title,
                       'style', s.communication_style)
                from public.staff s where s.slug = v_staff),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'project', pr.name,
                 'headline', left(o.body, 400),
                 'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
          from (select o2.* from public.outputs o2
                  join public.staff s2 on s2.staff_id = o2.staff_id
                 where s2.slug = v_staff
                 order by o2.created_at desc limit 5) o
          left join public.jobs j on j.job_id = o.job_id
          left join public.projects pr on pr.project_id = j.project_id
      ),
      'duties', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'what', r.description, 'every_minutes', r.period_minutes,
                 'on', r.enabled) order by r.slug), '[]'::jsonb)
          from public.responsibilities r
          join public.staff s on s.staff_id = r.staff_id
         where s.slug = v_staff
      )
    );
  end if;

  -- Then a project, resolved the way every other surface resolves one, so the
  -- names he actually says work here too.
  select r.project_id into v_project
    from app.resolve_project_by_name(v_said) r
   where r.confidence >= 0.55
   order by r.confidence desc
   limit 1;

  if v_project is not null then
    return jsonb_build_object(
      'about', 'project',
      'project', (
        select jsonb_build_object(
          'name', p.name, 'purpose', coalesce(p.purpose, p.description),
          'status', p.status,
          'connected_to', (select coalesce(jsonb_agg(jsonb_build_object(
                             'connector', a.connector, 'what', a.display_name,
                             'holds', a.artifact_kind) order by a.connector), '[]'::jsonb)
                             from public.project_attachments a
                            where a.project_id = p.project_id and a.enabled))
          from public.projects p where p.project_id = v_project
      ),
      'material', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'title', d.title, 'size', d.content_chars)
               order by d.content_chars desc), '[]'::jsonb)
          from (select * from public.documents
                 where project_id = v_project
                 order by content_chars desc limit 12) d
      ),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'who', coalesce(s.name, 'the office'),
                 'headline', left(o.body, 400),
                 'when', o.created_at) order by o.created_at desc), '[]'::jsonb)
          from (select o2.* from public.outputs o2
                  join public.jobs j2 on j2.job_id = o2.job_id
                 where j2.project_id = v_project
                 order by o2.created_at desc limit 5) o
          left join public.staff s on s.staff_id = o.staff_id
      ),
      'in_flight', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'kind', j.kind, 'status', j.state, 'since', j.created_at)
               order by j.created_at desc), '[]'::jsonb)
          from public.jobs j
         where j.project_id = v_project
           and j.state not in ('complete', 'failed', 'cancelled')
      )
    );
  end if;

  -- Nothing named. The state of play is a better answer than "I could not find
  -- that", because it is usually what the question was reaching for anyway.
  return jsonb_build_object('about', 'everything', 'state', app.voice_state());
end;
$function$;

comment on function app.voice_lookup is
  'One hop of real state for a voice call: a named colleague, a named project '
  'resolved through app.resolve_project_by_name, or the state of play. '
  'Read-only — writes still go through enqueue_inbound (0167).';

-- ---------------------------------------------------------------------------
-- PostgREST only sees public
-- ---------------------------------------------------------------------------

create or replace function public.voice_state()
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.voice_state() $$;

revoke all on function public.voice_state() from public;
grant execute on function public.voice_state() to service_role;

create or replace function public.voice_lookup(p_about text)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.voice_lookup(p_about) $$;

revoke all on function public.voice_lookup(text) from public;
grant execute on function public.voice_lookup(text) to service_role;

-- ---------------------------------------------------------------------------
-- Prove it answers with real state rather than an empty shape
-- ---------------------------------------------------------------------------
--
-- The failure this guards against is the one Grant hit: a function that
-- returns valid JSON with nothing in it looks identical to a working one from
-- every angle except his.

do $$
declare
  v jsonb;
begin
  v := app.voice_state();
  if jsonb_array_length(v->'projects') = 0 then
    raise exception 'voice_state knows of no projects, so a call would know nothing';
  end if;
  if jsonb_array_length(v->'team') = 0 then
    raise exception 'voice_state knows of no team';
  end if;

  v := app.voice_lookup('Legacy Coaching Course');
  if v->>'about' <> 'project' then
    raise exception 'voice_lookup did not resolve a project by its exact name (got %)', v->>'about';
  end if;
  if jsonb_array_length(v->'material') = 0 then
    raise exception 'voice_lookup found the project but none of its material';
  end if;

  -- And the sentence shape he actually speaks, rather than a bare name.
  v := app.voice_lookup('what is going on with the legacy coaching course');
  if v->>'about' <> 'project' then
    raise exception 'voice_lookup cannot find a project named inside a sentence';
  end if;

  -- Nothing named must still be an answer.
  v := app.voice_lookup('mmm');
  if v->>'about' <> 'everything' then
    raise exception 'voice_lookup has no answer when nothing is named';
  end if;
end
$$;

commit;
