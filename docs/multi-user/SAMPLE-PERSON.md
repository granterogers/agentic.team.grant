# The Sample Person: the authenticated test environment

Written 3 October 2026. This supersedes the "design only" status of `SAMPLE-ACCOUNT-DESIGN.md` for what is built; that
document remains the reference for what a later, richer sample could add.

## What it is

The Sample Person is **not a demo mode**. It is the existing P4 second person: a real `auth.users` login with its own
`offices` row (`205669cc-c270-4f11-ad63-b7ac4f994340`, kind `person`), its own projects, tasks, contacts, documents,
lessons, autonomy and appearance. It signs in by the same hand-off a magic link ends with, talks to the same deployed
gateway, and is served by the same worker and handlers as Grant. There is exactly one such account: nothing new was
created, the P4 one was given a purpose.

Its login password is in the Vault as `p4.second_person.password` and is never printed. The address is on a reserved
`.invalid` domain nothing delivers to. Nothing in the repository holds a credential.

Persona (fictional, unlike any of Grant's work so a leak is unmistakable): **Jordan Reyes**, owner of **Brightside Café**,
opening a second site. Three projects: *Second Location Launch*, *Seasonal Menu Research*, *Winter Pop-up*.

## What it holds (baseline `sample-baseline-1`)

| Surface | Content |
|---|---|
| Projects | 3, created through the gateway as the Sample |
| Team tasks | 17: overdue, due today, upcoming, milestone, done, a 120-character title, a 9-character title, two assigned to specialists |
| Personal tasks | 4, with priorities and due dates (one overdue, one today) |
| Contacts | 4 fictional people, `.invalid` addresses, one with a note |
| Documents | 6 uploaded files (markdown, csv, text; one with a 100-character name) |
| Lessons | 2 the Sample was "taught" |
| Tool requests | 2 open (shown, not answerable by a non-operator: see below) |
| Settings | autonomy `act_with_review`, accent Coral |
| Integrations | truthfully **not connected** to everything: no external credential exists for this office |

Not seeded, on purpose: calendar and mail (caches of a connected Google account; fabricating them would show a provider as
connected), chat history and "Needs you"/"Stuck" (they come from real jobs, and seeding them would put model traffic on
production for decoration). `SAMPLE-ACCOUNT-DESIGN.md` §3 lists how a later pass could.

## Commands

```
npm run sample:status          # what the office holds, and whether it matches the baseline
npm run sample:seed            # converge to the baseline (idempotent: run it twice, nothing changes)
npm run sample:reset           # remove what is not baseline, restore baseline states, then seed
npm run verify:sample-settings # 53 checks: the redesigned Global Settings, signed in, against the real gateway
npm run verify:sample-tool-requests # 24 checks: answering reach in its own office, and the cross-office negatives
npm run verify:sample-settings -- --grant   # plus one read-only look at what the operator is offered (the control)
npm run sample:shots -- <label>             # four widths x nine sections, populated, signed in
```

## How it is kept away from Grant

* Every command resolves the office **from the login**, then `guardOffice` refuses unless the office is not the operator's
  (`app.operator_office()`), is a person office, is owned by the Sample's owner key and is active. No name is typed; no
  office id is accepted from outside. The rule is a pure function (`scripts/sample/lib.ts`) with a test that points it at
  Grant's office and watches it refuse.
* Content is written **as the Sample**, through the gateway, so the office's own authorisation is exercised on the way in.
  Only what has no door (lessons, tool requests) uses the product's SQL writers, with the proven Sample office id.
* Reset deletes nothing from any other office, and nothing append-only: it converges mutable state. Team-assigned tasks it
  cannot delete are cancelled. `sample:reset` has been run twice and a third `status` reads "0 not baseline".
* The live Settings suite measures **Grant's office before and after** (projects, tasks, contacts, lessons, autonomy rows
  and their content, tool grants, tool requests, staff titles) and fails if any moved.

## What a non-operator is offered (a finding, and a decision for Grant)

Many Settings controls act on the **deployment**, not an office: who is on the team, tool grants, the shared Slack, Google
and Telegram connections, the switches that govern every office. The gateway refuses them to anybody who is not the
operator (`OPERATOR_ONLY`). The page used to offer them anyway; a second person pressed one and was told it was not theirs.
That was the whole reason "most of the app looked read-only" for the Sample. The gateway now says who is looking
(`viewer.operator` on `studio_settings`) and the page stops drawing what would be refused. **No policy changed.**

**Resolved (3 October 2026): answering reach is office-owned.** `approve_tool`, `decline_tool` and `revoke_tool` are no longer
operator-only, because `staff_tools` and `tool_requests` are per-office and the functions already match on the verified
office and require the answerer to be that office's own person. `staff_tool_set` (the Team page's tick box) and every
other deployment-wide action stay operator-only. Proof: `npm run verify:sample-tool-requests` (24 checks, including a request
raised in another office that the Sample cannot approve, decline or revoke, a spoofed `p_office` that changes nothing, and
the other offices' requests and grants fingerprinted unchanged) and `tests/gateway/office-owned-tool-requests.test.ts`.

## Using it for UX work

`scripts/sample/browser.ts` serves the **working tree's** `web/studio` and signs the Sample in against the real gateway, so an
unreleased page can be driven with real reads and writes before it is deployed. `startStudio`, `newPage`, `signIn`,
`openSettings`, `closeSettings`. Wait for the thing being asserted, not for a guess: a production write takes one to three
seconds.

## Known limits

* A production write is real latency and real (free-tier) cost; the Sample's jobs run on the real worker. Do not drive
  conversation suites through it; use `person-prompt.ts` (one question, in-process) for model-facing proofs.
* The Sample is `person` kind, not the `harness` kind the design proposed, so it can press Approve on what a person may
  approve. The effect doors still refuse it anything outside its own office (no Telegram, Slack or Google binding exists).
* Its office is named "P4 second person (acceptance)", which is what the model calls it. Renaming it would change what #404's
  acceptance looks for; not done.
