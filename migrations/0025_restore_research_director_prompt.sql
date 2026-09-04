-- 0025 — restore research-director's prompt after a verification script moved it
--
-- ## What happened
--
-- `scripts/verify/agents.ts` demonstrated prompt versioning by publishing a
-- version 2 for `research-director` and moving the pointer to it. Every check
-- passed. The pointer moved exactly as designed, and a real permanent role
-- ended the run carrying a prompt written by a test:
--
--   'You are the Research Director. This is a second version of the prompt,
--    written during verification to prove that versioning works end to end.'
--
-- Two separate mistakes, and the second is the one worth keeping.
--
--   1. A verification script mutated live identity. §21 reserves the shape and
--      the voice of the eight permanent roles; a test proving that reservation
--      should not be the thing that breaches it. This is the same mistake that
--      left gmail.send enabled (0022), in a different table, two hours apart.
--
--   2. Verifying a safety property must not require changing the thing being
--      protected. `verify:agents` now versions a FIXTURE specialist created for
--      the purpose, and asserts afterwards that all eight permanent roles are
--      still on version 1 - a check that would have caught this on the run that
--      caused it.
--
-- ## Why this is version 3 and not a correction of version 2
--
-- `staff_prompts` is append-only and `staff.prompt_version` cannot go
-- backwards, both deliberately: a pinned version must mean one thing forever,
-- or §6's configuration pinning stops explaining past jobs. Those rules do not
-- get suspended because the thing to be undone was mine. Version 2 stays in
-- the history as what it was, and version 3 restores the seeded text.
--
-- The cost is a permanent record of a mistake in a table anyone can read,
-- which is the correct cost.

begin;

insert into public.staff_prompts (staff_id, version, body, rationale, authored_by)
select
  s.staff_id, 3,
  'You are ' || s.name || ', ' || s.title || '.' || chr(10) || chr(10) ||
  'Responsibilities: ' || s.responsibilities || chr(10) || chr(10) ||
  'Expertise: ' || array_to_string(s.expertise, ', ') || '.' || chr(10) || chr(10) ||
  'How you communicate: ' || s.communication_style || chr(10) || chr(10) ||
  'Always state whether a claim is verified, inferred or speculative, and say '
  'plainly when the evidence does not support an answer. Surface disagreement '
  'rather than resolving it quietly.',
  'Restores the version-1 text after a verification script published a test '
  'prompt as version 2 and moved the pointer to it. Version 2 stays in the '
  'history because the history is append-only, which is the point of it.',
  'migration:0025'
from public.staff s
where s.slug = 'research-director'
on conflict (staff_id, version) do nothing;

update public.staff set prompt_version = 3 where slug = 'research-director';

-- The eight must all be pointing at prompts nobody wrote by accident. Version
-- numbers differ now (research-director is on 3), so the check is on the TEXT:
-- every permanent role's live prompt must be one authored by a migration.
do $$
declare
  v_bad text;
begin
  select string_agg(s.slug, ', ') into v_bad
  from public.staff s
  join public.staff_prompts p
    on p.staff_id = s.staff_id and p.version = s.prompt_version
  where s.permanent and p.authored_by not like 'migration:%';

  if v_bad is not null then
    raise exception
      'permanent role(s) % are pointing at a prompt not authored by a migration - '
      'refusing to record 0025 as applied', v_bad;
  end if;
end;
$$;

commit;
