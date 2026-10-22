begin;

-- public.self_improvement_headroom() was a wrapper over app.self_improvement_headroom() (migration 0216). Migration 1088
-- took the headroom off the Settings page, because nothing on the page reads it, and left the wrapper behind. check:callers
-- now reports it as a function with no caller. The app-schema function is kept: it is the one the wrapper named, and
-- nothing here changes what it returns. Only the unread public wrapper is dropped.

drop function if exists public.self_improvement_headroom();

commit;
