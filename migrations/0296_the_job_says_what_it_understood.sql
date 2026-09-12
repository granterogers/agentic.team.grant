-- 0296 — the job says what it understood
--
-- Issue #47. Grant: *"It really needs the... need to understand instructions."*
--
--   > **Restate the ask before acting.** The agent writes what it believes it
--   > was asked, in one sentence, into the job. Cheap, and it is the artefact
--   > that makes every later check possible — a wrong restatement is visible
--   > where a wrong output is not.
--
-- That is the whole of this migration, and the reasoning in it is the reason
-- it is worth a column rather than a log line: **a wrong reading is invisible
-- until you write it down.** An output built on a misreading looks like a
-- perfectly good output. The restatement is the one place the misunderstanding
-- shows before any work is done.
--
-- ## Why on `jobs` and not on `outputs`
--
-- The Issue says so, and gives the mechanical reason: `outputs` has no
-- `project_id` and joins through `jobs`. There is a better one — a job that
-- fails produces no output at all, and a misread instruction that failed is
-- exactly the case worth being able to read back.
--
-- ## Why not `job_plans.summary`
--
-- 0267 already stores what a job WOULD DO. That is a different sentence: a
-- plan is the office's intention, a restatement is its reading of the request.
-- They diverge precisely when something is wrong — "you asked me to summarise
-- the interviews" / "I will generate an audio overview" — and collapsing them
-- would hide the disagreement that makes both worth keeping.
--
-- ## Costed, because everything here is
--
-- One short model call per instruction. `inference_usage` already records
-- calls against a job, and the restatement is written by the same call that
-- already reads the instruction, so in practice it is free.

begin;

alter table public.jobs
  add column if not exists understood_as text;

alter table public.jobs
  drop constraint if exists jobs_understood_as_is_a_sentence;
alter table public.jobs
  add constraint jobs_understood_as_is_a_sentence
  check (understood_as is null
         or (length(btrim(understood_as)) between 8 and 400));

comment on column public.jobs.understood_as is
  '#47. What the agent believes it was asked, in its own words, written BEFORE '
  'acting. A wrong reading is invisible until it is written down: an output '
  'built on a misreading looks like a perfectly good output. Capped at 400 '
  'characters because a restatement that runs to a paragraph has become a plan '
  '(job_plans holds those) and stopped being checkable at a glance.';

/**
 * Record what the agent understood, once.
 *
 * Write-once by design. A second call is refused rather than allowed to
 * overwrite, because the value of a restatement is entirely that it was
 * written BEFORE the work — one that can be revised afterwards is a summary of
 * what happened, which is a different and much less useful thing.
 */
create or replace function app.understood(p_job_id uuid, p_sentence text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_said text := btrim(coalesce(p_sentence, ''));
  v_was  text;
begin
  if length(v_said) < 8 then
    return jsonb_build_object('error', 'a restatement has to say something');
  end if;
  -- Truncated rather than refused: losing the restatement because a model was
  -- verbose would lose the artefact this Issue is about, and the first 400
  -- characters of a long one still shows a misreading.
  v_said := left(v_said, 400);

  select understood_as into v_was from public.jobs where job_id = p_job_id;
  if not found then
    return jsonb_build_object('error', 'no such job');
  end if;
  if v_was is not null then
    return jsonb_build_object('ok', false, 'already', v_was);
  end if;

  update public.jobs set understood_as = v_said where job_id = p_job_id;
  return jsonb_build_object('ok', true, 'understood_as', v_said);
end;
$$;

create or replace function public.understood(p_job_id uuid, p_sentence text)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.understood(p_job_id, p_sentence) $$;

/**
 * Jobs whose reading nobody can check, and the ones where it disagrees.
 *
 * #47's second box: *"a restatement that does not match the request is
 * detectable in review."* Detectable means somebody can find them, which means
 * they have to be listed — a property that is true and unfindable is not
 * reviewable.
 *
 * No model here. It reports the pairs and the person or the evaluator reads
 * them; a function that judged the match itself would be a second opinion
 * about the same sentence, formed by the same kind of thing that wrote it.
 */
create or replace function app.readings(p_days int default 7, p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(r order by r.at desc), '[]'::jsonb)
    from (
      select j.job_id as id,
             j.kind,
             j.recipient_agent as who,
             left(coalesce(c.transcript, c.instruction, ''), 300) as asked,
             j.understood_as as understood,
             j.created_at as at
        from public.jobs j
        left join public.inbound_commands c
          on c.command_id = (j.pinned_config ->> 'command_id')::uuid
       where not j.is_fixture
         and j.created_at >= app.now_utc() - make_interval(days => greatest(coalesce(p_days, 7), 1))
         and coalesce(btrim(coalesce(c.transcript, c.instruction, '')), '') <> ''
       order by j.created_at desc
       limit greatest(coalesce(p_limit, 50), 1)
    ) r
$$;

create or replace function public.readings(p_days int default 7, p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public, pg_catalog
as $$ select app.readings(p_days, p_limit) $$;

grant execute on function app.understood(uuid, text) to ai_team_app;
grant execute on function public.understood(uuid, text) to ai_team_app;
grant execute on function app.readings(int, int) to ai_team_app;
grant execute on function public.readings(int, int) to ai_team_app;

commit;
