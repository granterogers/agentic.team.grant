-- Registering a connector asks it what it offers (#265).
--
-- `app.register_mcp_provider` ends by returning, in its own words:
--
--     'registered. Nothing is granted: ask it what it offers, then offer what
--      you want.'
--
-- There was no way to ask. `mcp.discover` is a complete, registered handler
-- that surveys a provider and writes `mcp_discovered_tools`, and NOTHING in
-- the repository or the database has ever enqueued one — zero jobs of that
-- kind have ever existed. So #265's chain broke at step two: a person could
-- register a provider and revoke a provider, `mcp_discovered_tools` stayed
-- empty for ever, and `offer_connector_tool` therefore had nothing it could
-- ever be pointed at.
--
-- This is the rule CLAUDE.md states as "an offer may only promise what the
-- press can perform", reached through a RETURN MESSAGE rather than an approval
-- option: the sentence described a next step that did not exist.
--
-- Found by `npm run check:reachable`, added in the same run, which asks of
-- every registered job kind what a person could do to start it. The browser
-- tier taught this class once (*"a job kind nobody enqueues is invisible to
-- check:callers"*) and it was fixed for that one kind and never asked about
-- the other thirty-five. Two more were unreachable: this, and #66's audio
-- collector.
--
-- ## Why a root job and not a child
--
-- There is no parent. A person registering a connector is the start of the
-- causal chain, so this follows `app.mcp_enqueue`'s pattern — a direct insert
-- naming its own correlation — rather than `app.enqueue_child`, which exists
-- to inherit a parent's correlation and project.
--
-- `project_id` is left null deliberately and the column permits it: a survey
-- of what a provider offers is not about any one dashboard project, and
-- attributing it to one would put a connector-wide fact under a single
-- project's history.
--
-- ## Announce
--
-- True. Registering a connector is something a person just did and the survey
-- is the answer to it — "it offers nine tools, none of them granted" is the
-- sentence that makes the next step obvious. The handler already declines to
-- announce nothing useful.
--
-- ## Spliced, not retyped
--
-- CLAUDE.md, twice: a function you are only patching must be built from its
-- LIVE definition. This replaces exactly the final return and leaves the four
-- guards, the insert and the conflict check byte-identical.

do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'register_mcp_provider';

  if v_def is null then
    raise exception 'app.register_mcp_provider is not there to patch';
  end if;

  v_old := $old$  return jsonb_build_object('ok', true, 'provider', v_id,
    'note', 'registered. Nothing is granted: ask it what it offers, then offer what you want.');$old$;

  v_new := $new$  -- Ask it what it offers. The note below has promised this
  -- since the function was written and nothing performed it.
  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by,
     priority, pinned_config, announce)
  values (gen_random_uuid(), null,
          format('mcp-discover-%s-%s', p_name, gen_random_uuid()),
          'mcp.discover', 'connector:register', 150,
          jsonb_build_object('provider', p_name), true);

  return jsonb_build_object('ok', true, 'provider', v_id,
    'note', 'registered, and I am asking it what it offers. Nothing is granted by that survey.');$new$;

  if position(v_old in v_def) = 0 then
    raise exception 'the return this migration patches is not in the live definition';
  end if;

  -- pg_get_functiondef emits no trailing semicolon. Recorded twice in
  -- CLAUDE.md, and it fails as a syntax error on the line AFTER the problem.
  execute replace(v_def, v_old, v_new) || ';';
end $$;

-- Drive it, because a migration that applies cleanly is not a function that
-- works, and this one now WRITES A JOB — a thing that cannot be deleted
-- afterwards. `public.jobs` is append-only (`job_state_transitions` holds every
-- row), so a probe that inserted one and tidied up would be a probe that
-- cannot tidy up.
--
-- So the whole drive is undone by a deliberate exception instead. Raising
-- inside a plpgsql block unwinds it to the implicit savepoint, which takes the
-- provider row AND the discovery job with it. CLAUDE.md's rule is to wrap the
-- CALL rather than the assertion, because the wrapper cannot know a call was
-- destructive until it already has been; this wraps both.
do $$
declare
  v_res jsonb;
  v_jobs int;
  v_name text := 'zz-reach-probe-' || substr(gen_random_uuid()::text, 1, 8);
begin
  v_res := app.register_mcp_provider(v_name, 'https://example.invalid/mcp');
  if v_res ? 'error' then
    raise exception 'registering refused: %', v_res->>'error';
  end if;

  select count(*) into v_jobs
    from public.jobs
   where kind = 'mcp.discover'
     and pinned_config->>'provider' = v_name;

  if v_jobs <> 1 then
    raise exception 'registering a provider enqueued % discovery jobs, wanted 1', v_jobs;
  end if;

  raise notice 'register -> discover: 1 job enqueued, as intended';
  raise exception 'probe done, undoing';
exception
  when others then
    if sqlerrm <> 'probe done, undoing' then
      raise;
    end if;
    raise notice 'probe rolled back: no provider and no job left behind';
end $$;
