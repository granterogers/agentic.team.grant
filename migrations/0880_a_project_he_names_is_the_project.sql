-- A project named in a message is the message's project, when no surface stated one (#416, Telegram, Slack and voice).
--
-- The cascade in app.enqueue_inbound already ran: a project an asset names, the project the surface stated, a Slack
-- channel's mapping, then the conversation's memory, then the general Conversation. Nothing used what the person SAID.
-- "How is the Japan trip going?" sent from a Telegram chat with no remembered project was filed under the Conversation
-- project, and its answer carried the Conversation header, although the message plainly named a project. (The answer's
-- content was already right, because retrieval reads any project the question names; the filing and the header were not.)
--
-- Added between the Slack mapping and the conversation memory, so an explicit name beats an inherited context and
-- anything a surface actually stated still beats the name. EXACTLY ONE project must be named: two ("compare the Japan
-- trip with the Financial Plan") is a comparison, not a choice, and falls through to the conversation's own project as
-- it did before. The matcher is app.projects_named_in with no asking project, which is the one deterministic reader of
-- "which projects does this text name": whole-word match of the project's name or one of its aliases, at least four
-- characters, active, never a fixture, never the catch-all, always inside the message's own office. No model decides it.
--
-- An explicit resolution is also what the existing block below it records as the conversation's project (so the next
-- message of the exchange needs no name), which is the behaviour the person asked for: name it once.
--
-- Built from the LIVE definition rather than retyped (an 8,000-character function with a dozen comments of history),
-- and the migration refuses to run if the anchor it splices at is missing or appears more than once.

begin;

do $m$
declare
  v_def text;
  v_anchor constant text := E'  v_scope := case c.origin_channel\n';
  v_block constant text := $b$
  /*
    0880. A PROJECT NAMED IN THE MESSAGE (#416).

    Only for the surfaces that have no loaded project of their own (Telegram, Slack, voice). The dashboard states its
    project from the page and never reaches here with a name to find. Exactly one project named is a resolution; none
    or several is not, and falls through to what it always did.
  */
  if v_project is null and c.origin_channel in ('telegram', 'slack', 'voice') then
    declare
      v_named uuid[];
    begin
      select array_agg(n.project_id)
        into v_named
        from app.projects_named_in(c.office_id, c.instruction, null) n;
      if coalesce(array_length(v_named, 1), 0) = 1 then
        v_project := v_named[1];
      end if;
    end;
  end if;

$b$;
  v_count integer;
begin
  select pg_get_functiondef('app.enqueue_inbound(uuid)'::regprocedure) into v_def;

  v_count := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_count <> 1 then
    raise exception 'enqueue_inbound: expected the anchor exactly once, found % times', v_count;
  end if;
  if position('0880.' in v_def) > 0 then
    raise exception 'enqueue_inbound already carries 0880';
  end if;

  v_def := replace(v_def, v_anchor, v_block || v_anchor);
  execute v_def;
end
$m$;

commit;
