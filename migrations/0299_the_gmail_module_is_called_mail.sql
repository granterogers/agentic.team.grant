-- 0299 — the gmail module is called mail.ts
--
-- 0298 recorded `gmail.draft` as delivered by `src/google/gmail.ts`. The file
-- is `src/google/mail.ts`. Written from memory rather than from `ls`, which is
-- the same class of mistake 0298 exists to prevent — a claim about the office
-- that nothing checked.
--
-- Fixed forward rather than by editing 0298, because an applied migration is
-- immutable and `check:migrations` verifies its checksum. Editing it in place
-- passed locally for about ninety seconds and would have failed for everyone
-- else for ever.
--
-- Idempotent, so it is safe whether or not the value was already corrected by
-- hand while this was being noticed.

begin;

update public.tool_permissions
   set delivered_by = 'src/google/mail.ts — draft only; gmail.send is disabled by policy'
 where tool = 'gmail.draft';

commit;
