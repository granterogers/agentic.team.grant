# ADR-0064 — A person connects their own Telegram

**Status:** accepted (Telegram only) · **Date:** 4 October 2026 · **Issue:** #410

## Context

Telegram is one bot for the deployment (the chief of staff). Who a Telegram user IS lives in `public.subject_identities`
(`origin_channel`, `actor` -> office), and the webhook has refused every sender that table does not name since 0607. A second
person therefore had no way in: the only writer of that table was an operator command, so their answers could reach them on the
dashboard only. #410 asked for a decision between per-office bots and one shared bot bound to a person.

## Decision

One shared bot, bound to a person, by a challenge only a signed-in person can obtain. Not per-office bots: they would multiply
credentials and webhooks per person and need an operator for each.

1. Team HQ (a verified session; the office comes from the session, never from the request) calls `app.link_begin`. It stores the
   SHA-256 of a random 36-hex token, returns the token once, and keeps at most one live challenge per office and channel
   (ten minutes, five an hour). A person on the operator's office is refused: its channels are the operator's.
2. The person opens `https://t.me/<bot>?start=link_<token>` (a button, nothing to type) and taps Start.
3. The webhook reads exactly `/start link_<36 hex>` from a PRIVATE chat by a non-bot, calls `app.link_redeem` BEFORE the
   stranger check, and nothing else a stranger sends is accepted. The database takes the office from the token's row and the actor
   from the verified sender. Single use: the row is locked, checked and marked used together.
4. Refusals are one word and one sentence to the person (unknown, used, expired, revoked, wrong chat), and a refusal does not
   spend the token. A Telegram user already in another office is NOT moved (`taken`); an office that already has a Telegram does
   not get a second; a lookup that fails is a 503 so Telegram retries, and nothing is lost.
5. Disconnect removes the identity and marks that person's chats undeliverable in the same statement, so nothing more is paged.

The gateway actions are person-only (not in `SERVICE_MAY`); the office key is refused by name. `OPERATOR_SECTIONS` is unchanged:
`channel_link` is an office-scoped section.

## Not decided here

* **Slack.** A person cannot connect Slack from this: it is a workspace INSTALL (an OAuth consent by a Slack admin into the one
  Slack app), a different mechanism and a different trust question. Settings still says Slack is connected by whoever runs the
  deployment.
* A person with more than one Telegram, a group chat for a person, or moving a Telegram between offices. Disconnect then connect
  again is the move.

## Why this shape and what it must not become

The refusal of "a token for office A takes a person out of office B" is the property that makes a shared bot safe: nobody is
ever bound to an office by anything they typed. If a later change lets the webhook choose an office from the message, or lets
the redeem function take an office argument, it is a defect (`redeem takes no office from its caller` is asserted by
`verify:channel-link`). Proofs: `verify:channel-link` (DB, rolled back), `sample:channel-link` (as the Sample, desktop and phone),
`scripts/isolated/telegram-link.ts` (the real webhook handler against a rebuilt replica, sabotage red then green).
