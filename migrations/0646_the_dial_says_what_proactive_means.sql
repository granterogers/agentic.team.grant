-- 0646 - the dial's four sentences say what proactive work may do, in three tiers, and nothing is left ungoverned.
--
-- Grant's decision 7: the office should be genuinely proactive - notice, reason, inspect, research, prepare,
-- recommend - and proactivity creates no authority beyond what the dial and the effect policy already grant:
--
--   1. observe / think     - reading and reasoning: proceeds at every setting.
--   2. prepare / internal  - drafts, recommendations, reversible internal work: proceeds according to the dial.
--   3. consequential       - contacting somebody else, an irreversible or destructive act, a consequential write:
--                            asks, at every setting, as the effect policy already says (level 3 never proceeds, an
--                            outside audience never proceeds, and a duty is never "asking").
--
-- That is what `autonomy_policy` and `app.authorize_effect` already did; what was wrong was the COPY. 0633 told the
-- truth that four duties were not governed by the dial; with 0640-0643 they are (Vikunja, Slack channels, Notion
-- import, Slack token rotation all go through the one policy), so the caveat is removed and each setting says what the
-- team may do on its own. No second dial and no new setting: only the words on the existing four.
--
-- The page's own fallback (`web/studio/settings.js`) carries the same sentences and is changed in the same commit.

create or replace function app.autonomy_choices()
returns jsonb language sql immutable set search_path to '' as $f$
  select jsonb_build_array(
    jsonb_build_object('id', 'observe', 'name', 'Watch only',
      'note', 'The team notices, reads and thinks things through and tells you what it sees. It writes nothing - not even a draft - and starts nothing.'),
    jsonb_build_object('id', 'suggest', 'name', 'Ask me first',
      'note', 'The team notices, researches and prepares drafts and recommendations on its own. Anything that leaves our own records waits for you.'),
    jsonb_build_object('id', 'act_with_review', 'name', 'Act, then show me',
      'note', 'Routine work proceeds and lands in front of you afterwards. Anything that reaches outside still waits for you.'),
    jsonb_build_object('id', 'act', 'name', 'Act',
      'note', 'The team acts, including outward. Deleting, spending, rotating a credential and anything meant for somebody else still stop and ask.')
  )
$f$;
