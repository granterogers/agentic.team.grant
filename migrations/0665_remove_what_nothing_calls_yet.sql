-- 0665 - remove four functions nothing calls yet (multi-user P2).
--
-- `check:callers` is in the gate and it refused the four helpers 0654 and 0657 added: a capability with nothing that
-- calls it is #72's defect however sensible the reason, and the reasons were all "P3 will". So they go, and P3 adds them
-- WITH their caller.
--
--   app.provision_office(uuid, text, text, text)  the sign-up path; P2 creates no second person (a hard stop of this phase)
--   app.office_of_auth(uuid)                      session -> office; the session resolver is converted in P3
--   app.system_office()                           read once, by the backfills, at apply time (0657, 0658, 0659)
--   app.p2_guard_table(text, text, text, text)    the installer the backfills ran; every guard it created exists
--
-- Applied migrations that name them (0654, 0657, 0658, 0659) are history and still replay in order, because this one runs
-- after them. Nothing else calls any of the four: the unreachable-function check found no caller, which is the finding.

drop function app.provision_office(uuid, text, text, text);
drop function app.office_of_auth(uuid);
drop function app.system_office();
drop function app.p2_guard_table(text, text, text, text);

-- ROLLBACK (not part of the migration): re-create from 0654 (provision_office, office_of_auth), 0656 (system_office,
-- p2_guard_table). Nothing depends on them.
