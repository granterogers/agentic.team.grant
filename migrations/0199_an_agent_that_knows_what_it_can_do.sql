-- An agent that knows what it can do.
--
-- Issue #64. Claire, to Grant on Telegram, 11 September:
--
--     "I cannot add interactive Telegram buttons; I only generate plain text.
--      My replies stay limited to text…"
--
-- That was false when she said it. §12's six buttons had been built for months
-- and the pager was already rendering them; as of #59 every Telegram message
-- carries thumbs up and down by default. She was asked whether she could do a
-- thing she does automatically, and said no. Grant then asked me to add a
-- feature that already existed.
--
-- ## Why she said it
--
-- Nothing tells an agent what the office can do, so when asked about itself the
-- model answers from what a LANGUAGE MODEL is — a text generator. That is right
-- about the model and wrong about the system it is part of. And it will happen
-- again in a different sentence: "I cannot read your calendar", "I cannot
-- create a notebook", "I cannot see your Drive" are all equally plausible and
-- all false.
--
-- This is #51 pointed inward. That issue is *agents do not know what their
-- components can do*; this is *an agent does not know what IT can do*.
--
-- ## Derived, never written down
--
-- The list comes from `staff_tools` × `tool_permissions` — the same AND that
-- `app.staff_may_use` enforces, so what an agent SAYS it can do and what it is
-- ALLOWED to do cannot drift. A hand-maintained list would be wrong within a
-- month and wrong in the worst direction: claiming a capability that was
-- revoked.
--
-- The channel abilities are not tools and are not in that table, so they are
-- stated here as facts about the office rather than as grants. They are the
-- ones he actually asked about.

begin;

create or replace function app.what_i_can_do(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tools', coalesce((
      select jsonb_agg(t.tool order by t.tool)
        from public.staff_tools st
        join public.tool_permissions t on t.tool = st.tool
       where st.staff_slug = p_slug
         and t.enabled
    ), '[]'::jsonb),
    /*
      What the office does for every agent, whether or not it holds a tool.

      These are properties of the delivery layer, not grants, so they are not
      in `tool_permissions` — and they are exactly what Claire got wrong. A
      message she sends carries buttons because `TelegramTransport` puts them
      there; she does not have to do anything, which is precisely why she did
      not know she could.
    */
    'channels', jsonb_build_array(
      'Your Telegram messages automatically carry thumbs up and thumbs down '
        || 'buttons, and approval requests carry Go ahead and Not now. You do '
        || 'not add these yourself — the office does it for you.',
      'You can send and receive on Telegram and Slack.',
      'Voice notes Grant sends are transcribed before you see them.'
    ),
    'measured_at', app.now_utc()
  )
$$;

comment on function app.what_i_can_do(text) is
  'What this agent can actually do, derived from staff_tools x '
  'tool_permissions — the same AND app.staff_may_use enforces, so what an '
  'agent claims and what it is allowed cannot drift (#64).';

create or replace function public.what_i_can_do(p_slug text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.what_i_can_do(p_slug) $$;

commit;
