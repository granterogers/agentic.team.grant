# The public Sample Office

Status: **live in production on 5 October 2026.** Branch `claude/multi-user-p4`. Migrations 0897 and 0898.

A logged-out visitor to Team HQ sees two plain paths: **sign in or create your own office**, and **Explore the Sample Office**.
The Sample is real Team HQ, open to anybody with no email, link, password or key, filled with one made-up café's story. It is a
read-only look around plus a small, capped, safe chat with the team. Nothing a visitor does is saved, and nothing they do can
reach a real person, a real office or a real credential.

## The three kinds of non-person office (kept separate)

| Office kind | What it is for | Who sees it |
|---|---|---|
| `sample` | The polished public demo: Jordan Reyes of Brightside Café. One active office. | Any visitor, as a guest. |
| `test` | Engineering fixtures and the verification suites' quarantine. | Nobody but harnesses. |
| `system` | The deployment's own work (duties, health, sweeps). | Nobody. |

The separate **Sample Person** (`docs/multi-user/SAMPLE-PERSON.md`) is a genuine second *person* with a real login, used to test
what an ordinary customer sees. It is not the public Sample and the two never share data.

## What a visitor sees and can do

1. **Logged out.** One screen: a card "New here? Explore a Sample Office" above "Sign in or create your own office". The Explore
   button is on the first screen on a desktop (y 455 of 900) and a phone (y 416 of 844) with no scrolling.
2. **Entering** needs nothing. The page asks the `signin` function's `sample` action for a session; the function ignores any
   address it is sent. A banner then reads "Sample Office, a made-up café, so changes are not saved" with **Create your own
   office** and **Sign in** always in reach, and the header's sign-out reads **Leave sample**. Neither route traps.
3. **Inside**, everything is the real Team HQ reading real rows: three projects (Riverside Café Launch, Autumn Menu Research,
   Winter Market Pop-up), their to-dos, documents, contacts, schedule, activity and the team. Opening a project, a document or a
   module works exactly as it does for a person.
4. **Talk to the team.** The dock's chat works. One real model turn costs one inference, is answered by the real worker (for the
   test question on 5 October, the finance director) from the Sample's own papers, and never reaches anybody outside the page.
5. **What is refused, in words.** Any change (adding a task, making a project) is refused by the gateway with the sentence "This
   is a sample office, so changes are not saved. Create your own office to make it yours." Calling the team says it needs your own
   office. A voice note says the same. A visitor never reads a code.

## Real versus simulated

| Real | Simulated or withheld |
|---|---|
| The page, the gateway, the database reads, the search, the project views | The data: a fictional café, fictional contacts on the reserved `.invalid` domain |
| The chat: the real worker, the real agents, the real model | Any change: refused, so nothing is "saved" |
| Per-visitor chat history, kept apart for each visitor | Voice calls and voice notes: refused (metered) |
| The refusal sentences, the caps, the banner | Slack, Telegram, Google, Notion, email: no connection exists in the office |

## Why it cannot reach anybody else (the design)

The decision is a **read-only guest plus a harness-classified, per-visitor chat**. There is no reset job to run and no state to
restore, because the only thing a visitor can write is their own conversation, and that is marked as nobody's real work.

- **A guest is a new member kind** (`office_members.kind = 'guest'`, 0897). The gateway maps it to a principal kind `guest`.
  A guest may run exactly one action, `sample_say` (`GUEST_MAY`). Every other action returns `403 sample_readonly` with a
  sentence, before any function is called. `sample_say` itself is `guestOnly`, so anybody else gets `403 guest_only`.
- **Reads are scoped to the one office.** Operator-only pages (`google`, `build`, `drive`, `bots` and the like) are refused.
  `app.conversation_history` returns nothing for a sample office; a visitor reads only their own thread through
  `app.sample_conversation`, keyed by a random visitor id the browser holds.
- **A visitor's turn is harness traffic by definition.** `app.harness_job` treats an inbound command whose context names a
  visitor as nobody's real work. That hides it from every reader of real activity and makes `app.job_origin` refuse outside
  effects. In production the test turn was `harness = true` with **0 deliveries**.
- **No credential is borrowed.** The visitor's session belongs to a login that owns only the Sample office. `src/auth/speaker.ts`
  returns null for a guest, which protects `voice`, `voice-token` and `mcp`. The Sample office has no connection of its own.
- **`app.sample_login()` works only while the office is sealed** (its sole member is a guest). `app.sample_office_open` flips it
  open for the operator's seeding, and the seeding script seals it again.

### Cost and abuse protection

All set in `public.system_config` and enforced inside `app.guest_allow`, before a job exists:

- 6 questions per visitor per hour (`sample.turns_per_visitor_hour`), 15 per visitor per day (`sample.turns_per_visitor_day`).
- 250 questions per day across all visitors (`sample.turns_per_day`). Past it the team "needs a rest" until tomorrow.
- At most 2 questions still being answered per visitor, 600 characters per question, one project per question.
- The visitor id must look like a random 20 to 64 character token, and must belong to the Sample office's own guest.
- No voice, no MCP, no uploads, and no action that leaves the page.

A visitor who is stopped is told why and pointed at **create your own office**.

## What a visitor cannot spoil

Visitors cannot change the Sample, so there is nothing to restore. The two things they can write, their own chat turns, are scoped
to their visitor id and never read by another visitor. A visitor who clears their storage simply starts a new thread.

Known drift that *does* need an operator: the seeded dates are relative to the day it was seeded, so the story ages. See the
follow-up issues at the end.

## Is the Sample clean rather than test debris?

Yes, and this was checked rather than assumed. On 5 October a stray question was found on the Sample's home: the catch-all
"Conversations" project carried "Create the Slack channel #unnamed for 'Unnamed'?" raised by the Slack channel sweep, which asks
every *active office*. **0898** limits that sweep to `kind = 'person'`, and the one open question was resolved by the operator
with a recorded reason (the guest rule correctly refused the Sample's own owner key to answer it). The Sample now shows 0 open
questions. The seeded data contains no `fixture`, `verify-` or real-office names, which `sample:public-ui` asserts on every run.

## Operating it

```
npm run sample:public -- status      # is it sealed, seeded, how many projects and rows
npm run sample:public -- provision   # create the office and its sealed guest login (once)
npm run sample:public -- seed        # (re)write the story through the gateway, then seal
npm run sample:public -- verify      # production API checks, 9 of them, no model call
npm run sample:public-ui -- [label] [--page=https://ai-team-hq.vercel.app] [--chat]   # the visitor's journey, desktop and phone
npm run sample:public-transition     # visitor -> real person -> sign out -> visitor, on the deployed page
```

`--chat` spends one real turn. Run `npm run trust:proxy-ca` first for a browser against the deployed page.

## Deployed

| What | Version | Previous / rollback |
|---|---|---|
| Migration 0897 (guest kind, guest functions, `harness_job`, `conversation_history`, wrappers) | applied | additive; the sample office stays sealed if the page is rolled back |
| Migration 0898 (Slack channel sweep limited to person offices) | applied | restore the previous body of `app.provision_missing_channels` |
| `hq-api` | v891 | v890 is commit `7f858c9c`; recovered live source is the base of the staged copy |
| `signin` | v126 | the `sample` action is new and additive; v124 before this work |
| `voice`, `voice-token`, `mcp` | v656, v685, v661 | the guest refusal rides in `src/auth/speaker.ts` |
| Page | `dpl_3yZSXFhyNXjbhee7V86sUfA8Yui3` | original `dpl_8QwvvES1oRridjeokGzu2MMGdEYm` (before this work); then `dpl_DrHpy8xh…`, `dpl_3E7t94dY…`, `dpl_2z4wvtNQ…` |

**Nothing held was deployed.** Function and page deploys were built from the *live bytes* plus only this change, never from the
working tree (which carries the held Slack self-service and polish work). The page deploy tool uploaded 7, 1, 1 and 1 files; the
function deploy tool refuses a staged file the live bundle does not have. `scripts/deploy/hq-function-staged.ts` and
`hq-page-delta.ts --root=` are the tools; the staged tree is `.out/stage/` (not committed).

## Evidence

- Isolated proofs on a rebuilt replica: `scripts/isolated/sample-office.ts` 47/47 (including sabotaging `harness_job`,
  `conversation_history` and `authority_refusal`, each of which turns a check red) and `sample-gateway.ts` 33/33 against the real
  `hq-api` and `signin` (97 actions refused to a guest with nothing written; removing the allow-list in a copy lets a guest through).
- Production API check `sample:public -- verify` 9/9: session with no address; reads limited; operator pages 403; a write 403 with
  the sentence and **an exact count of 0** rows written; the voice door 401.
- Production browser `sample:public-ui`: 24 checks per width on desktop and phone, including one real chat turn answered from the
  Sample's papers (£88,000 for the Riverside site, and an honest "I have no record" for a coffee supplier that is not in them).
- `sample:public-transition`: 28/28. Logged out, Explore, Sign in, a real person (the P4 second person), sign out, Explore again.
  The real office never shows the Sample's projects and carries no banner; the Sample never shows the person's projects; no session,
  visitor id or office data is left in browser storage after either exit.
- Unit tests: `tests/sample/public-plan.test.ts` (10), `tests/auth/speaker.test.ts` (guest refused, person and harness controls),
  `tests/web/due-words.test.ts` (4, proved able to fail).

## Defects found while reviewing it as a customer, and fixed

1. A stray Slack question on the home screen (above). Fixed at the class, 0898.
2. A raw `sample_readonly` code printed under the Create project button. The gateway had sent a sentence; the page printed the code.
   `office.js` now shows the sentence for the two visitor refusals.
3. A **completed** task labelled "30 Sept · overdue" while the late count said 0. `dueWords` now agrees with `isLate`.
4. The first harness chat check passed while the team was still thinking (it matched figures other panels already show). It now
   requires the answer text and refuses the "working on it" state.
5. Two checks from `check:callers` and `check:pressable` caught new surfaces with no visible caller; fixed with npm entries and a
   greppable request in `chat.js`.

## Known limits (recorded, not hidden)

- **Static dates age.** Open an issue-sized refresh duty before the Sample reads as stale (see the issue list).
- **The team's wording is neutral.** The worker (held) builds the prompt identity from the office owner; for a non-person office it
  says "the person you work for", and the Sample's context arrives as three office-scoped lessons. A sample-aware identity is a worker
  change and is queued behind the held release.
- **If the gateway read fails** (or a proxy answers with an HTML page), the page falls back to its built-in invented example
  projects and says so in a strip: "none of this is your office's own data". It is honest, and those example projects carry names
  that echo the prototype's. This happened several times *in the build sandbox* where the proxy sometimes answers 502 with no
  `x-vercel-id`; it was not seen from the product itself (see the harness diagnostic in `public-ui.ts`).
- **Voice is not offered.** A visitor is told it needs their own office.
