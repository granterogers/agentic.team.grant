-- The public wrappers the Browser tab needs (#135, #16).
--
-- PostgREST exposes `public` and nothing else. The half that gets forgotten is
-- always the wrapper, which is why this is its own migration named after the
-- page rather than a footnote to 0442.
--
-- Three READERS get one. `request_stop` gets one too, because Stop is a button
-- on that page and a button with no route is #72's defect.
--
-- `browser_session_open` and `browser_session_revoke` deliberately do NOT.
-- Opening a session means putting a cookie jar in the Vault, which is
-- `hq-api`'s job with the service key and not something a page may reach
-- directly, and revoking has to remove the jar as well as the row -- a public
-- wrapper would offer half of it, which is 0350's dangling reference waiting
-- to happen.

create or replace function public.browser_sessions_for(p_project uuid)
returns jsonb language sql stable security definer set search_path to ''
as $function$ select app.browser_sessions_for(p_project) $function$;

create or replace function public.browser_lately(p_project uuid, p_limit int default 30)
returns jsonb language sql stable security definer set search_path to ''
as $function$ select app.browser_lately(p_project, p_limit) $function$;

create or replace function public.browser_budget()
returns jsonb language sql stable security definer set search_path to ''
as $function$ select app.browser_budget() $function$;

create or replace function public.request_stop(p_job uuid, p_who text default 'grant')
returns jsonb language sql security definer set search_path to ''
as $function$ select app.request_stop(p_job, p_who) $function$;
