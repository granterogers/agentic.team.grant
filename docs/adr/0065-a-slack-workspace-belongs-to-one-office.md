# ADR-0065 — A Slack workspace belongs to one office

**Status:** accepted (the decision and the receiving half); the sending half is described and not built · **Date:** 4 October 2026 ·
**Issue:** #410 (Slack)

## Context

ADR-0064 let a person connect their own Telegram. It deliberately left Slack out, because Slack is not a one-tap identity: it is a
workspace INSTALL (an OAuth consent by a Slack admin into the one Slack app), and the question of who owns what is different. What
the code already says about Slack, read on 4 October:

* **Data ownership is already per workspace.** `public.slack_workspaces` (primary key `team_id`) has `office_id not null`, and a
  Slack channel's office is its WORKSPACE's (0884; a channel with no project still has an owner). A delivery to Slack for a
  workspace owned by another office is refused (0883/0884).
* **Who is speaking is per Slack user.** `slack-events` admits a sender only if `public.subject_identities` names
  (`slack`, user id) -> office, then asks `slack_ingress_ok` that the workspace the event came from belongs to the SAME office. A
  user bound to office A cannot speak through a workspace owned by office B.
* **Sending is single-tenant.** `src/office/pass.ts` builds ONE Slack client from the first enabled `slack_app_credentials` row
  (`limit 1`), one `SlackOffice`, one `teamId`. `slack_app_credentials` is keyed by `slack_app_id`, and holds app-level secrets (client
  secret, config tokens that rotate) together with the install's bot token, so a second install of the same app cannot be a second row.
* The one Slack app's signing secret and bot user id are deployment settings of `slack-events`, not per workspace.

## Decision

**The owner of a Slack connection is a WORKSPACE, owned by exactly ONE office; the person who installs it is the first (and, for a
personal office, only) admitted sender.**

1. A person connects Slack from Settings -> Messaging -> Slack (a signed-in session; the office comes from the session). The
   gateway mints a single-use, ten-minute, hashed `state` bound to that office and returns Slack's authorise URL.
2. Slack redirects to the deployment's `slack-oauth` callback with `code` and `state`. The callback exchanges the code (client
   id and secret are deployment settings; the secret is in the vault), and the DATABASE takes the office from the state's row and the
   workspace and user from Slack's verified answer. Nothing in the request chooses an office; a callback cannot.
3. A workspace already owned by another office is NOT taken (`taken`); an office that already has a workspace does not get a second.
4. The installing user is bound as the office's Slack sender; other members of the workspace stay strangers (acknowledged, stored
   nowhere) until a later decision admits them.
5. The bot token lives in the vault, in a new per-install table (`slack_installs`), never in the browser and never in a response.
   `slack_app_credentials` stays the OPERATOR's app-level row and is not a place for a second person's install.
6. Disconnect revokes at Slack, retires the install, unbinds the user and marks the workspace uninstalled in one statement; connecting
   again is a new install.

Not per-office Slack apps: that multiplies apps, credentials and webhooks per person and needs a Slack admin step per person.

## What must be true before this is "connected" to a person

A connect flow that completes while nothing is ever delivered would be the misleading success this repository refuses. So the
status Settings shows is derived from what is true: **installed** (the OAuth completed), **can receive** (the sender is admitted),
**can reply** (the worker resolves a bot token for that office). Until the sending half exists the third is false and the page says
so in words; the receiving half is proved, the sending half is the next piece.

**The sending half (not built here):** `pass.ts` must build one channel per active install and `slackChannel` must pick the client
by the delivering job's office (`app.job_office`), with `teamId` per install; project-channel provisioning, the handoff narrator
and token rotation stay the operator's. Slack's reply to a DM or mention needs only the workspace's bot token and the origin
channel/thread already on the inbound command.

## External prerequisites (Grant, once; the code cannot do these)

* Slack app settings -> **Manage Distribution**: activate public distribution so other workspaces can install it.
* Slack app settings -> **OAuth & Permissions** -> Redirect URLs: add `https://<project-ref>.supabase.co/functions/v1/slack-oauth`.
* The app's **client id** (public, not a secret) into `system_config` key `slack.client_id`. Until it is set, the Connect control says
  that Slack is not switched on for other workspaces yet, rather than offering a button that cannot work. The client secret is already
  in the vault (`slack.client_secret`); the config token that could read the client id from the manifest has been dead since 18 September.

## Not decided here

More than one workspace per office; admitting further members of a workspace; Slack Connect guests; enterprise grid installs.

## What it must not become

If the callback ever takes an office from the request, if a workspace can be claimed by an office that did not start the install, or
if the bot token reaches a response body, a log or the browser, it is a defect. `verify:slack-link` asserts each.
