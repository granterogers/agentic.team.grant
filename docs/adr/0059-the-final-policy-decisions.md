# 0059 - the seven final policy decisions

Status: accepted, 1 October 2026. Closes the policy half of the audit (ADR-0058 left these to Grant).

## Decisions
1. **Vikunja.** Create and update proceed under the board connection (`task.board.write`, level 2, destination-scoped);
   delete is `task.board.delete`, level 3, needs an exact approval per task and can never be standing. A crash between
   the remote create and recording its id adopts the marked remote task instead of duplicating it.
2. **Slack channels.** A project Grant created explicitly carries a one-use channel authority recorded by the database
   from the verified person (`slack_channel_authority`). Unprompted creation asks (`slack.channel`). No renaming exists
   and none is authorised.
3. **Notion.** Connecting a database as a person mints a standing authority scoped to that database
   (`standing_authorizations.scope_ref`). A different destination needs its own deliberate connection; page contents
   are data.
4. **Slack rotation.** Always asks (`slack.rotate`, level 3, never standing); the question names the expiry of the
   pair it replaces so an approval cannot be reused.
5. **Learning.** Presentation preferences are learned automatically. A teaching that grants permission, directs an
   effect at someone else, or runs on a schedule, and every procedure, is offered through `suggestions` and only
   becomes state on his press. Authorization never reads lessons.
6. **Retrieval.** Own project first; expansion only to the same office's active non-fixture siblings
   (`app.sibling_projects`, the one place a future user boundary lives), with scope labels on every hit.
7. **Proactive autonomy.** One dial, unchanged engine: observe/think proceeds, internal prepare follows the dial,
   consequential or external stays authorization-governed.

## Discovered on the way
Forty-three `public` tables had RLS off and default grants to `anon`/`authenticated`; the anon key could read
`standing_authorizations` over REST. 0642 revokes those grants and the default privileges. Whether those tables should
also have row policies is a separate question for the multi-user phase.
