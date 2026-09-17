-- Two writers for one decision, removed within the hour (#135, #72).
--
-- 0442 shipped `app.browser_session_revoke`, which nulls the credential
-- reference and marks the row revoked. 0447 then shipped
-- `app.browser_session_forget`, which does that AND deletes the Vault row --
-- because a revoke that leaves the secret behind leaves a credential nobody
-- can see and nothing will ever use.
--
-- Keeping both would be two doors to one decision, which is the shape this
-- repository has paid for repeatedly: 0282 and 0293 (a constraint loosened
-- while its pre-check stayed strict), 0365 (a pre-check that only ever existed
-- on one of two writers). The one that removes less is the dangerous one,
-- because it is the one somebody reaches for by name.
--
-- `check:callers` is what found it: `browser_session_revoke` had no caller in
-- `src/` and never would, since the page calls Forget. A capability nobody can
-- reach is either a missing caller or a redundant function, and this is the
-- second.

drop function if exists app.browser_session_revoke(uuid);
