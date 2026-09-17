-- Two readers of `slack_channel_map` that nothing calls (#272).
--
-- `app.channel_for(project, staff_slug)` returns one channel and a boolean
-- called `exists_already`, which is the shape of the "do we already have one"
-- half of a provisioning flow. `app.slack_channels_for_project(project)`
-- returns every active channel id for a project.
--
-- Neither has a caller. `check:callers` says so -- the first is one of the ten
-- it found that nothing in the repository names AT ALL -- and the reason is
-- visible in one grep: `src/slack/provision.ts` queries
-- `public.slack_channel_map` directly, in six places, for the specific columns
-- each step needs. The provisioner outgrew both functions and nobody removed
-- them.
--
-- ## Why this is a removal and not a wiring
--
-- #272's rule is explicit: *"Do not mechanically connect functions merely to
-- satisfy check:callers."* Rewriting six working inline queries to call these
-- two would be precisely that -- risk in the one path that creates channels in
-- Grant's real workspace, for no behaviour he could observe. And they do not
-- answer the questions the provisioner asks: it wants a channel id AND a name
-- for a named purpose, and one of these returns ids only while the other
-- returns a single row with a hardcoded `true`.
--
-- ## Neither has a public wrapper, so the 0454 order does not apply
--
-- That sequence dropped wrappers first and let the check prove the functions
-- behind them dead. Here there is nothing to drop first: PostgREST cannot
-- reach either, and the check already reports that nothing names them. The
-- proof exists before the migration rather than because of it.
--
-- If a caller is ever wanted again, the query is four lines and the table is
-- unchanged. What is being removed is a claim that something reads it.

drop function if exists app.channel_for(uuid, text);
drop function if exists app.slack_channels_for_project(uuid);

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname in ('channel_for', 'slack_channels_for_project')
  ) then
    raise exception 'a channel lookup survived the drop — check the argument list';
  end if;
end $$;
