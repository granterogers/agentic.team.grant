/*
  0614 - a credential is not a person

  Issue #385 (and the identity half of the run-3 brief). Until now the
  gateway said "grant" for anyone presenting hq.api_token, because 0608's model
  was one machine credential with one owner. That made every approval, every
  standing authorization, every reach grant, every autonomy change and - since
  0611 - taking a remembered No back something a script, an agent or an MCP
  client could do AS GRANT by holding the office key. The same key could also
  ask the sign-in function for a magic link for Grant's own address and become
  him outright (supabase/functions/signin, link_for_operator).

  THE MODEL, in the database (the gateway decides which principal a request is;
  the database decides what each kind may DO):

    person   - a member of the office signed in as themselves, or a channel
               identity the office lists (subject_identities).
    harness  - a test principal. It may exist so the verification suites can
               drive the real gateway, but it decides ONLY what is provably test
               traffic: a job the harness predicate owns, a fixture project. It
               can never decide something real. A name that carries a harness
               prefix (app.harness_label) is a harness principal whatever row
               lists it - the restrictive reading wins, 0304's asymmetry.
    service  - the office key. NOT a principal at all here: the gateway
               writes no name for it, so every function that needs an answering
               person refuses it by name (0608's mechanism, now the only way
               the key is treated).
    unknown  - anything else. Refused.

  What this migration changes:

    - office_members and subject_identities carry `kind` (person | harness);
    - app.principal_kind, and app.authority_refusal(p_by, p_job, p_project),
      which is principal_refusal PLUS the harness rule with the context the
      caller has. principal_refusal is unchanged (known or not), because its
      TypeScript callers pre-check with it and a harness identity pressing a
      button on its own fixture must still get as far as the door that decides;
    - every function through which a person DECIDES takes the answering
      principal and refuses through authority_refusal: answering a question,
      taking a No back, approving or declining reach, granting or revoking a
      standing authorization, setting autonomy, granting or revoking a
      specialist's tool, approving or discarding a made document. The four
      wrappers that hardcoded 'grant' (hq_revoke_tool, hq_autonomy_set,
      hq_staff_tool_set) no longer do, and the two document wrappers gain the
      argument. Old signatures are dropped by exact argument list;
    - office_member returns the member's kind, so the sign-in function can
      refuse to mint a session for a PERSON (a test member only);
    - a test member exists (verify-operator), so the suites keep a real,
      signed-in way to drive the gateway that cannot decide anything real.

  Deploy order: this migration, then hq-api and signin (they pass the
  principal and read kind), then the worker if src changed. New DB + old
  gateway: the old gateway still names the key 'grant', so behaviour is unchanged
  until it is deployed, EXCEPT the wrappers whose signatures changed, which the
  old gateway calls without the new argument: they fail loudly (no such function)
  rather than deciding as nobody. Old DB + new gateway: the new gateway sends
  p_by to functions that do not take it, and PostgREST refuses - loudly, and no
  approval is made.
*/

alter table public.office_members
  add column if not exists kind text not null default 'person';
alter table public.office_members drop constraint if exists office_members_kind_known;
alter table public.office_members
  add constraint office_members_kind_known check (kind in ('person', 'harness'));

alter table public.subject_identities
  add column if not exists kind text not null default 'person';
alter table public.subject_identities drop constraint if exists subject_identities_kind_known;
alter table public.subject_identities
  add constraint subject_identities_kind_known check (kind in ('person', 'harness'));

update public.subject_identities set kind = 'harness' where app.harness_label(subject);

-- A test member: real address (a sign-in link is generated, never mailed), a harness
-- owner key. `verify-` so the harness predicate names it on sight.
insert into public.office_members (email, note, owner_key, kind)
values ('verify.operator@example.com',
        'A TEST principal for the verification suites: a real signed-in session that can decide only test traffic. Never a person.',
        'verify-operator', 'harness')
on conflict do nothing;

create or replace function app.principal_kind(p_by text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when btrim(coalesce(p_by, '')) = '' then 'unknown'
    when app.harness_label(btrim(p_by))
      or exists (select 1 from public.subject_identities s where s.subject = btrim(p_by) and s.kind = 'harness')
      or exists (select 1 from public.office_members m where m.owner_key = btrim(p_by) and m.kind = 'harness')
      then 'harness'
    when exists (select 1 from public.subject_identities s where s.subject = btrim(p_by) and s.kind = 'person')
      or exists (select 1 from public.office_members m where m.owner_key = btrim(p_by) and m.kind = 'person')
      then 'person'
    else 'unknown'
  end
$$;
comment on function app.principal_kind(text) is
  'person | harness | unknown. A harness label or a harness row makes a principal harness, whatever else lists it: the restrictive reading wins.';

create or replace function app.principal_known(p_by text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select app.principal_kind(p_by) <> 'unknown' $$;

create or replace function app.fixture_project(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select is_fixture from public.projects where project_id = p_project), false) $$;
revoke all on function app.fixture_project(uuid) from public;
grant execute on function app.fixture_project(uuid) to ai_team_app, service_role;

/*
  The one question every deciding function asks. `p_job` and `p_project` are
  the CONTEXT the caller can prove: a harness principal is allowed only where
  that context is itself test traffic. No context is no permission.
*/
create or replace function app.authority_refusal(
  p_by text, p_job uuid default null, p_project uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case app.principal_kind(p_by)
    when 'unknown' then
      case when btrim(coalesce(p_by, '')) = ''
        then 'I cannot tell who is answering, so this was not taken as an answer.'
        else 'That answer came from somebody the office does not know, so it was not taken.'
      end
    when 'harness' then
      case when (p_job is not null and app.harness_job(p_job))
                or (p_project is not null and app.fixture_project(p_project))
        then null
        else 'A test principal cannot decide something real, so this was not taken.'
      end
    else null
  end
$$;
comment on function app.authority_refusal(text, uuid, uuid) is
  'principal_refusal plus the harness rule: a test principal decides only what is provably test traffic (a harness job or a fixture project). The caller passes the context it can prove; null is no permission.';
revoke all on function app.authority_refusal(text, uuid, uuid) from public;
grant execute on function app.authority_refusal(text, uuid, uuid) to ai_team_app, service_role;
revoke all on function app.principal_kind(text) from public;
grant execute on function app.principal_kind(text) to ai_team_app, service_role;

-- ---- who is a member, and of what kind --------------------------------------
drop function if exists public.office_member(text);
drop function if exists app.office_member(text);
CREATE OR REPLACE FUNCTION app.office_member(p_email text)
 RETURNS TABLE(ok boolean, owner_key text, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select true, m.owner_key, m.kind
    from public.office_members m
   where m.email = lower(btrim(coalesce(p_email, '')))
   union all
  select false, null::text, null::text
   where not exists (
     select 1 from public.office_members m2
      where m2.email = lower(btrim(coalesce(p_email, '')))
   )
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.office_member(p_email text)
 RETURNS TABLE(ok boolean, owner_key text, kind text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select * from app.office_member(p_email) $function$
;


-- ---- the deciding functions, spliced from their live definitions ----------
CREATE OR REPLACE FUNCTION app.hq_answer_blocker(p_blocker_id uuid, p_answer text, p_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b        public.blockers;
  v_answer text := btrim(coalesce(p_answer, ''));
  v_next   text;
  v_was    text;
  v_standing jsonb;
  v_started integer := 0;
  v_by     text := btrim(coalesce(p_by, ''));
  v_refusal text;
  v_gen    jsonb;
begin
  /*
    0608. WHO IS ANSWERING is an argument the caller has to prove, never a
    default this function supplies.

    Every 'grant' in this body used to be a literal: the approval child job
    said `approved_by grant`, a standing authorization said `given by grant`,
    and the decision log said `decided_by grant` - whoever had pressed. The
    decision log's own comment says that value is "what lets the reader treat
    this as a record of what HE said", so an answer from anybody else was
    recorded as his word.

    The door now says who answered (the gateway from the verified credential,
    the chat path from the channel identity the sender was admitted under),
    and this refuses one that names nobody the office knows. Refused BEFORE
    the row is locked or read, so a refusal reveals nothing about the question.
  */
  v_refusal := app.principal_refusal(v_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;

  /*
    0596: ONE ANSWER PER QUESTION, EVEN AT THE SAME MOMENT.

    Read without a lock, and the update below does not re-check the state, so
    two overlapping answers - the dashboard and Telegram, or a double press -
    both saw 'open' and both performed what answering promises. Reproduced on
    production by verify:approval-race: one question, two child jobs. FOR
    UPDATE makes the second answer wait for the first and then read
    'resolved', which is the existing "already answered" reply.
  */
  select * into b from public.blockers where blocker_id = p_blocker_id for update;
  if not found then
    return jsonb_build_object('error', 'there is nothing here to answer');
  end if;
  /*
    0614. A test principal decides only test traffic. Asked AFTER the row is held
    (the context is the question's own job and project) and BEFORE anything is
    revealed about it, so the refusal is the same sentence for a stranger.
  */
  v_refusal := app.authority_refusal(v_by, b.job_id, b.project_id);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if b.state <> 'open' then
    -- Not an error. Answering something already answered is what two open tabs
    -- produces, and the honest reply is what it was answered with.
    return jsonb_build_object('ok', false, 'already', true,
      'state', b.state::text, 'resolution', b.resolution);
  end if;
  if v_answer = '' then
    return jsonb_build_object('error', 'say what the answer is');
  end if;

  if array_length(b.approval_options, 1) is not null
     and not (v_answer = any (b.approval_options)) then
    return jsonb_build_object('error', format(
      'that is not one of the answers this asks for: %s',
      array_to_string(b.approval_options, ', ')));
  end if;

  /*
    A generation approval is answered by the function that already knows what
    approving one MEANS — it queues the follow-on job. Resolving the row here
    instead would mark it answered and queue nothing.
  */
  select pinned_config ->> 'approval_next' into v_next
    from public.jobs where job_id = b.job_id;
  if v_next is not null then
    v_gen := app.answer_generation_approval(
      p_blocker_id,
      -- The affirmative half of whatever this blocker offered. Matched against
      -- the words agents actually use rather than assuming the first option is
      -- the yes, which is true today and is not a rule anybody wrote down.
      lower(v_answer) in ('yes', 'approve', 'approved', 'go ahead', 'ok', 'do it'),
      v_by
    );
    -- 0611: the option chosen and who chose it are columns, so nothing has to
    -- read them back out of the resolution sentence.
    update public.blockers
       set answered_option = v_answer, answered_by = v_by
     where blocker_id = p_blocker_id and state <> 'open';
    return v_gen || jsonb_build_object('ok', true, 'answer', v_answer);
  end if;

  /*
    "From now on" becomes a row, not a sentence (#15).

    The Drive watcher has offered "do not ask again" as an option since it was
    written, and nothing could honour it -- there was nowhere to write the
    answer. Now the blocker NAMES the tool a standing authorization would cover
    and which of its options grants one, so this does not have to read English
    to find out. `blockers.approval_options` is free text a handler composes;
    deciding a permission by matching words in it would be the parsing defect
    #130 is about, one layer up.

    Scoped to the blocker's own project. A question asked about one project is
    not consent for every project, and `grant_standing` takes null for
    everywhere only when a caller passes it deliberately.

    Never fatal, and never silent: if the grant is refused (a level-3 tool, an
    unknown one) the answer still resolves the blocker and the outcome says
    what happened, because losing Grant's answer to protect a permission would
    be the worse of the two.
  */
  if b.standing_tool is not null
     and b.standing_option is not null
     and v_answer = b.standing_option then
    v_standing := app.grant_standing(
      b.standing_tool, b.project_id,
      format('You answered "%s" on %s.', v_answer, b.created_at::date), v_by, null);
  end if;

  /*
    And the office remembers it decided this (#129).

    The options Grant did NOT pick are `ruled_out`, which is the field the
    Issue is about and the one that would otherwise be skipped: *"we chose
    Notion" is worth a fraction of "we chose Notion over Drive because..."*.
    They are right here, in `approval_options`, and no model is needed to know
    what they were.

    `decided_by` is the answering person, which is what lets the reader treat this as a
    record of what HE said rather than as the office's own prose.

    Never fatal. Losing his answer to protect a memory of it would be the wrong
    way round, and a write allowed to fail must say so rather than vanish --
    which is why the failure is recorded rather than swallowed.
  */
  begin
    perform app.record_decision_made(
      b.requested_action,
      v_answer,
      (select array_agg(o) from unnest(coalesce(b.approval_options, array[]::text[])) o
        where o <> v_answer),
      coalesce(nullif(btrim(b.why_needed), ''), 'You answered the question the office asked.'),
      v_by, b.project_id, b.job_id, null);
  exception when others then
    perform app.cannot(b.job_id, 'not_capable', 'remember this decision',
                       'hq_answer_blocker', left(sqlerrm, 400), null);
  end;

  /*
    And the answer DOES the thing (#257).

    `handlers/drive.ts` has offered "Add them to the project as source
    documents" since #62, and answering it has never been able to work: the
    page token advances whether or not Grant was asked, so by the time he
    answers, those files are no longer in the change list and there is nothing
    left to act on. A dead option on a question he can see.

    So the blocker carries WHAT ANSWERING PERFORMS, written by the handler that
    raised it: a job kind and one payload per thing. Not a model's words and
    not an interpretation of the option text -- the parsing defect #130 is
    about, on a path that enqueues work.

    Bounded on purpose: through `app.enqueue_child`, on the blocker's own job,
    so the child inherits the project and the requester and
    `enforce_delegation_depth` caps it. Nothing here can reach a project the
    question did not come from.

    Never fatal, and never silent: a failure here is an impediment, because
    losing his answer to protect a queue would be the wrong way round.
  */
  if b.on_answer is not null
     and b.on_answer ? 'option'
     and (v_answer = (b.on_answer ->> 'option')
          -- 0610: other options that PERFORM the same thing. "Add them from now
          -- on" was accepted and left the files it was being asked about
          -- unread, because only one option could carry the work.
          or coalesce(b.on_answer -> 'also', '[]'::jsonb) ? v_answer)
     and coalesce(b.on_answer ->> 'kind', '') <> '' then
    begin
      select count(*) into v_started
        from jsonb_array_elements(coalesce(b.on_answer -> 'payloads', '[]'::jsonb)) as pay
       where app.enqueue_child(b.job_id, b.on_answer ->> 'kind', pay, interval '0', false)
             is not null;
    exception when others then
      perform app.cannot(b.job_id, 'not_capable',
                         format('do what answering %L promised', v_answer),
                         'hq_answer_blocker', left(sqlerrm, 400), null);
    end;
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = format('%s — answered by %s', v_answer, v_by),
         answered_option = v_answer,
         answered_by = v_by
   where blocker_id = p_blocker_id;

  /*
    And the job is let go, by the road the state machine allows.

    A resolved blocker whose job is still parked in `waiting_user` is a job
    nothing will ever pick up — the interface would say answered and nothing
    would run. But `waiting_user -> queued` is not an edge, and 0290's header
    says why it should not be: `queued` means nobody has looked at this yet.

    So: park it, then queue it. Both transitions are written to
    `job_state_transitions` by the trigger, and the ledger reads as what
    happened — the wait ended, then the job went back in the queue.
  */
  -- One definition, in app.let_job_go (0496, 0497). A second copy here is
  -- two writers of one field, which is what 0472 exists to stop.
  perform app.let_job_go(b.job_id, format('answered: %s', v_answer));

  return jsonb_build_object('ok', true, 'answer', v_answer, 'blocker', p_blocker_id,
    -- Null when the answer granted nothing, which is the common case.
    'standing', v_standing,
    -- How many jobs answering actually started. Zero is the common case
    -- and is not an error; a number he can hold against what he was
    -- promised is the point (0350's rule about a claim with nothing
    -- behind it).
    'started', v_started);
end;
$function$
;

CREATE OR REPLACE FUNCTION app.answer_generation_approval(p_blocker uuid, p_approved boolean, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b public.blockers;
  v_config jsonb;
  v_next text;
  v_new uuid;
  v_refusal text;
begin
  -- 0608: called directly by the button path as well as by hq_answer_blocker,
  -- so it refuses an unidentified approver for itself.
  v_refusal := app.principal_refusal(p_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;

  -- 0611: locked, like hq_answer_blocker (0596). This is the door the button path
  -- calls directly, and it now writes the durable answer, so two presses at the
  -- same moment must not both read 'open' and leave an answer that contradicts
  -- the job that ran.
  select * into b from public.blockers where blocker_id = p_blocker for update;
  if not found then
    return jsonb_build_object('error', 'no such request');
  end if;
  v_refusal := app.authority_refusal(btrim(coalesce(p_by, '')), b.job_id, b.project_id);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if b.state <> 'open' then
    return jsonb_build_object('already', true, 'state', b.state, 'resolution', b.resolution);
  end if;

  update public.blockers
     set state = 'resolved',
         resolved_at = app.now_utc(),
         resolution = case when p_approved
                        then format('approved by %s', p_by)
                        else format('declined by %s', p_by) end,
         -- 0611: the option chosen is a column whichever door answered, so an
         -- answer from a button is as visible to the boundary as one typed.
         answered_option = case when p_approved then b.approval_options[1]
                                else coalesce(b.decline_option, b.approval_options[2]) end,
         answered_by = p_by
   where blocker_id = p_blocker;

  if not p_approved then
    return jsonb_build_object('approved', false);
  end if;

  select pinned_config into v_config from public.jobs where job_id = b.job_id;
  -- `notebook.generate` when the job did not say, which is every approval
  -- created before this migration. An in-flight request must not become
  -- unanswerable because the schema moved under it.
  v_next := coalesce(v_config ->> 'approval_next', 'notebook.generate');

  insert into public.jobs
    (parent_job_id, correlation_id, project_id, idempotency_key, kind,
     requested_by, priority, pinned_config)
  select b.job_id, j.correlation_id, j.project_id,
         format('approved-%s', p_blocker),
         v_next,
         j.requested_by,
         -- Ahead of the queue: he has just pressed a button and is watching.
         50,
         coalesce(v_config, '{}'::jsonb)
           || jsonb_build_object('approved_by', p_by, 'approval', p_blocker)
    from public.jobs j where j.job_id = b.job_id
  returning job_id into v_new;

  return jsonb_build_object('approved', true, 'job_id', v_new, 'kind', v_next);
end;
$function$
;

CREATE OR REPLACE FUNCTION app.withdraw_refusal(p_blocker uuid, p_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  b         public.blockers;
  v_by      text := btrim(coalesce(p_by, ''));
  v_refusal text;
  v_days    integer;
begin
  /*
    Only through the gateway. PostgREST sets request.jwt.claims for the request,
    with the role of the key that was presented: the gateway presents the service
    key, and a call with the anon key, or from SQL that never came through
    PostgREST (a handler, a job, a script), carries no such role and is refused
    here whatever the grants say. The worker connects as a database owner, so the
    grant alone restricts nobody there; this is the check that does.
  */
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    return jsonb_build_object('error', 'Only the gateway, acting for a signed-in person, can take a No back.');
  end if;
  v_refusal := app.principal_refusal(v_by);
  if v_refusal is not null then
    return jsonb_build_object('error', v_refusal);
  end if;
  if app.principal_kind(v_by) <> 'person' or exists (select 1 from public.staff s where s.slug = v_by) then
    return jsonb_build_object('error',
      'Only a person can take a No back, and that name is not a person the office answers to.');
  end if;

  select * into b from public.blockers where blocker_id = p_blocker for update;
  if not found then
    return jsonb_build_object('error', 'there is no such question');
  end if;
  if b.state <> 'resolved' or b.answered_option is null
     or b.answered_option is distinct from b.decline_option then
    return jsonb_build_object('error', 'That question was not answered No, so there is nothing to take back.');
  end if;
  if b.refusal_withdrawn_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'withdrawn_at', b.refusal_withdrawn_at);
  end if;
  v_days := app.refusal_days();
  if b.resolved_at <= app.now_utc() - make_interval(days => v_days) then
    return jsonb_build_object('error', 'That No has already run out, so the office may ask again without this.');
  end if;

  update public.blockers
     set refusal_withdrawn_at = app.now_utc(), refusal_withdrawn_by = v_by
   where blocker_id = p_blocker;

  perform public.append_event(
    p_correlation_id => extensions.gen_random_uuid(),
    p_actor_kind => 'user',
    p_actor => v_by,
    p_trigger => 'approval',
    p_action_type => 'refusal.withdrawn',
    p_reversible => false,
    p_project_id => b.project_id,
    p_before_state => jsonb_build_object('remembered_no', true),
    p_after_state => jsonb_build_object('remembered_no', false),
    p_rationale_summary => format('%s took back the No to: %s', v_by, left(b.requested_action, 120)),
    p_source_refs => '[]'::jsonb,
    p_tool_used => b.standing_tool,
    p_related_job_id => b.job_id);

  return jsonb_build_object('ok', true, 'withdrawn', p_blocker, 'by', v_by,
    'note', 'Nothing was approved. The next attempt may ask again.');
end;
$function$
;


-- ---- the wrappers that decide, each asking who and about what -------------------
create or replace function public.hq_approve_tool(p_request_id uuid, p_limits jsonb default null, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select case when app.authority_refusal(p_by) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.approve_tool(p_request_id, btrim(p_by), p_limits) end
$$;
create or replace function public.hq_decline_tool(p_request_id uuid, p_reason text default null, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select case when app.authority_refusal(p_by) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.decline_tool(p_request_id, btrim(p_by), p_reason) end
$$;
create or replace function public.hq_grant_standing(p_tool text, p_reason text, p_project uuid default null,
    p_until timestamptz default null, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select case when app.authority_refusal(p_by, null, p_project) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null, p_project))
              else app.grant_standing(p_tool, p_project, p_reason, btrim(p_by), p_until) end
$$;
create or replace function public.hq_revoke_standing(p_authorization uuid, p_reason text default null, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select case when app.authority_refusal(p_by, null,
                     (select project_id from public.standing_authorizations where authorization_id = p_authorization)) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null,
                     (select project_id from public.standing_authorizations where authorization_id = p_authorization)))
              else app.revoke_standing(p_authorization, p_reason) end
$$;

drop function if exists public.hq_revoke_tool(text, text);
create or replace function public.hq_revoke_tool(p_slug text, p_tool text, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select case when app.authority_refusal(p_by) is not null
                and not (app.principal_kind(p_by) = 'harness' and app.harness_label(p_slug))
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.revoke_tool(p_slug, p_tool, btrim(p_by)) end
$$;

drop function if exists public.hq_autonomy_set(text, uuid, text);
create or replace function public.hq_autonomy_set(p_level text, p_project_id uuid default null,
    p_reason text default null, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select case when app.authority_refusal(p_by, null, p_project_id) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null, p_project_id))
              else app.hq_autonomy_set(p_level, p_project_id, btrim(p_by), p_reason) end
$$;

drop function if exists public.hq_staff_tool_set(text, text, boolean);
create or replace function public.hq_staff_tool_set(p_slug text, p_tool text, p_granted boolean, p_by text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select case when app.authority_refusal(p_by) is not null
                and not (app.principal_kind(p_by) = 'harness' and app.harness_label(p_slug))
              then jsonb_build_object('error', app.authority_refusal(p_by))
              else app.hq_staff_tool_set(p_slug, p_tool, p_granted, btrim(p_by)) end
$$;

drop function if exists public.approve_document(uuid, text, text[], uuid, uuid);
create or replace function public.approve_document(p_document uuid, p_collection text default null,
    p_tags text[] default null, p_related_task uuid default null, p_related_source uuid default null,
    p_by text default null)
returns jsonb language sql security definer set search_path = 'public', 'pg_catalog' as $$
  select case when app.authority_refusal(p_by, null,
                     (select d.project_id from public.documents d where d.document_id = p_document)) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null,
                     (select d.project_id from public.documents d where d.document_id = p_document)))
              else app.approve_document(p_document, p_collection, p_tags, p_related_task, p_related_source) end
$$;

drop function if exists public.discard_document(uuid, text);
create or replace function public.discard_document(p_document uuid, p_why text default null, p_by text default null)
returns jsonb language sql security definer set search_path = 'public', 'pg_catalog' as $$
  select case when app.authority_refusal(p_by, null,
                     (select d.project_id from public.documents d where d.document_id = p_document)) is not null
              then jsonb_build_object('error', app.authority_refusal(p_by, null,
                     (select d.project_id from public.documents d where d.document_id = p_document)))
              else app.discard_document(p_document, p_why) end
$$;

-- Every wrapper here is the gateway's alone (0613's rule, stated again so this file stands alone).
do $close$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('hq_approve_tool','hq_decline_tool','hq_grant_standing','hq_revoke_standing',
                                'hq_revoke_tool','hq_autonomy_set','hq_staff_tool_set','approve_document',
                                'discard_document','office_member')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $close$;
