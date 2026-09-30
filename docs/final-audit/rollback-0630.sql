-- Rollback of 0630. Deploy the previous slack-events FIRST (the current one asks public.slack_team_ok and refuses when it cannot).
begin;
drop function if exists public.slack_team_ok(text);
drop function if exists app.slack_team_ok(text);
delete from app.schema_migrations where name like '0630_%';
commit;
