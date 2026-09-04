-- 0022 — restore the gmail.send policy disable, and record why it needed
-- restoring
--
-- ## What happened
--
-- `scripts/verify/agents.ts` contained a check meant to prove that the
-- application role cannot grant itself a policy-disabled tool. It ran:
--
--     update public.tool_permissions set enabled = true where tool = 'gmail.send'
--
-- ...and asserted that this was refused. Two things were wrong with it, and
-- together they turned a safety check into the breach it was checking for:
--
--   1. It went through the Management API, which connects as a SUPERUSER. The
--      statement was never going to be refused, because it was not running as
--      the role whose privileges were under test.
--   2. Its pass condition was
--      `msg.includes('permission denied') || msg.includes('(no error')` - it
--      accepted the successful UPDATE as a pass.
--
-- So the check reported ✅, and `gmail.send` was left ENABLED in the live
-- database. §11 says Gmail is draft-only by policy; that policy was off for as
-- long as it took the next run to notice.
--
-- ## Why it was not noticed immediately
--
-- The neighbouring check asked `app.tool_allowed('gmail.send', false)` and got
-- `false`, which looked like confirmation. It was not. `tool_allowed` refuses
-- level-3 tools without explicit approval BEFORE any policy question is
-- reached, so that check returns false whether the tool is policy-disabled or
-- merely unapproved. It was measuring the approval rule and being read as a
-- measurement of the policy. A check that passes identically in the safe and
-- the unsafe state is not a check - the same defect the POC gates turned up
-- seven times, and the reason every "cannot" in this project is proved by
-- attempting it and reading the refusal.
--
-- The discriminating question is whether the tool is refused WITH approval
-- granted, which only a policy disable can do. `verify:agents` now asks that
-- one, plus a direct drift comparison against the seeded baseline.
--
-- ## The change
--
-- Restores the seeded policy. Written as a migration rather than a one-off
-- UPDATE because the state of the tool policy is part of the schema's meaning,
-- and a security-relevant setting that was off for a while should be visible
-- in the migration history rather than quietly corrected.

begin;

update public.tool_permissions
set enabled = false,
    disabled_reason =
      '§11: Gmail is draft-only by policy. The OAuth scope permitting it is not '
      'a reason to expose it; sending stays disabled until Grant explicitly '
      'enables it. Re-disabled by 0022 after a defective verification check '
      'enabled it - see that migration''s header.'
where tool = 'gmail.send';

-- Fail the migration if the restore did not take. An UPDATE that matches no
-- rows succeeds silently, which is the wrong outcome for a security setting.
do $$
begin
  if not exists (
    select 1 from public.tool_permissions where tool = 'gmail.send' and not enabled
  ) then
    raise exception 'gmail.send is not disabled after 0022 - refusing to record this migration as applied';
  end if;
end;
$$;

commit;
