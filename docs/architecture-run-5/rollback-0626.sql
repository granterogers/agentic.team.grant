-- Rollback of 0626: remove the doors and the workflow row (the webhook then dispatches as before ONLY if the previous function is deployed).
-- Deploy the previous telegram-webhook FIRST, or the current one will find no ci_reserve and start no runner (a voice note stays queued for a worker that can hear).
begin;
drop function if exists public.ci_release(uuid, text);
drop function if exists public.ci_reserve(text, text, text, text, uuid);
drop function if exists app.ci_release(uuid, text);
delete from public.ci_workflows where workflow = 'voice-note';
delete from app.schema_migrations where name like '0626_%';
commit;
