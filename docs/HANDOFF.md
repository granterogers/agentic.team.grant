# Handover

> **Read `CLAUDE.md` first.** It is the standing brief — Grant's own
> instructions, the hard constraints, the traps this repository has already
> fallen into, and how to run and verify everything. This document is only the
> current state.
>
> **Actionable work lives in
> [Issues](https://github.com/granterogers/agentic.team.grant/issues)**, under
> milestones M0 → v1.0. Not here, not in commit messages, not in chat.
>
> ## State as of 2026-09-13
>
> | | |
> |---|---|
> | Tests | **1,007 passing across 61 files** · `verify:ui` **60/60** · `verify:design` 21/21 · `verify:slack` **70/70** · `verify:settings` **37/37** · `verify:layouts` **68 states, 0 findings** · `verify:wired` **64 controls across 21 screens, none dead** · `verify:controls` **289 desktop / 307 phone / 100 team, 0 findings** |
> | The conversation | `npm run verify:conversation-all` — **218 checks in 4m19s**: history 50, echo 13, equivalence 16, transport 19, chat 37, dictation 38, channels 22, access 23 |
> | End-to-end sweep | **570 checks, 431 controls pressed** — `docs/testing/e2e-2026-09-11.md` (#41) |
> | Identity | `verify:identity` **29/29** — project name resolution works, aliases seeded (0179) |
> | Restore | `backup:rehearse` **9/9**; a fresh archive at 0180, 24,822 rows, 71 tables |
> | Free tier | measured, not guessed: **48 MB of 500 MB** database, **41 MB of 1 GB** storage (`public.free_tier_headroom()`) |
> | The conversation's growth | **25.8 messages a day** across four surfaces at ~495 bytes each — about **fifty years** of room at that rate (`public.conversation_growth()`, on the Usage page). ADR-0026 |
> | Office health | 0 real failures in 24h of 121 jobs (`app.office_health`) |
> | Migrations | **353 applied** |
> | Trunk | `main` exists and carries everything — **but the repository default is still `claude/new-session-o2oklu`** (#7, one click, needs Grant) |
> | Current milestone | **M0 — visual prototype.** Not started; assessment and GitHub scaffolding done |
>
> **Waiting on Grant:** the default-branch click (#7) and rotating a leaked
> GitHub PAT (#18). Neither blocks development.
>
> ## Phase 7 — Communications, finished overnight 13–14 September

**#191's eight children are all closed.** One conversation, every surface.

| | |
|---|---|
| **#196** dictation | A microphone beside Send. Browser transcription (free); the button says *before* you press it that Chrome sends the audio to Google. One dictation is one message (0089's precedent). No addressing by voice — §5 forbids an adapter deciding. The microphone release is **asserted**, not assumed: `verify:dictation`, 38 checks, counts microphones opened against closed. |
| **#205 / #200** arrivals and accessibility | "Emma replied" pinned inside the thread, plus one polite live region — deliberately not `role="log"`, which would announce the "Asking the office" placeholder as an answer. Every message carries author, time, addressee and surface as visually-hidden text. `verify:access` grew to 23 checks: every visible control has a name, one `main` landmark, heading order. |
| **#204** retention | Measured rather than guessed, which is the point. **Nothing needs deleting and most of it could not be** — a job is permanent, so an answer is. The real unboundedness was in the READER: a `coalesce` around a column made `jobs_project_state_idx` unusable and every conversation load read every job in the table. 116ms → 32ms. **ADR-0026.** |
| **#202** transport failures | Bounded retry (five attempts, 30s doubling to fifteen minutes, in `system_config`), a **Try again** in the thread, and `app.undelivered` with a sentence a person can act on. Nothing ever claims a revoke or a delivery it cannot prove. |
| **#198** connection controls | Five honest states per surface — never / quiet / carrying / degraded / **unchecked**. Slack and Telegram can now be disconnected, and the answer names what was **not** revoked as clearly as what stopped. |
| **#197** mobile | The keyboard case, which is where this screen actually failed: composer 208px of 336, thread 51px, newest message hidden. Now 156/168, nav out of the way, thread follows. |
| **#201** proving it | `verify:equivalence` — the same sentence through four surfaces, asserted as **agreement between them** rather than against an expected value. |

**The two problems it appeared to surface were the harness, not the office —
corrected the next morning by 0351.** "Telegram is degraded, 21 undelivered"
was `scripts/poc/gate-3.ts` impersonating Grant as Telegram user 4242 (the
`gate-%` fixture branch never fires, because `enqueue_inbound` puts the channel
prefix in front) plus eight orphaned fault injections that both readers counted
as real because `coalesce(is_fixture, false) = false` over a LEFT join treats
an unattributable row as a genuine one. **Telegram reads `carrying`; there are
zero real failed deliveries.** `verify:transport` now asserts the whole reading
carries no harness traffic, not merely that its own rows are hidden.

**Grant's decision on 13 September, recorded as #70:** Telegram is one bot, the
chief of staff. The other seven are to be retired; individuals are reached in
Slack and in the studio. **Done** — 0352 disables the seven with a stated
reason, points the pager at `chief-of-staff`, and derives `hq_team`'s Telegram
username from the registry rather than a column.

**Also filed:** #207 — a project screen has one heading, so heading navigation
reaches nothing. Found by the new check, filed rather than asserted because the
fix is a design change.

> ## What changed on 2026-09-14 (night)
>
> **Disconnecting Google now revokes the grant AT Google (#109, migration
> 0354).** 0350 did the forget half honestly and could not do more, because
> Postgres makes no HTTP calls. A `google.revoke` job finishes it: 200 means
> revoked, 400 `invalid_token` also means revoked (already dead is still dead),
> anything else is reported as NOT revoked with Google's own words and the
> Connections panel says to do it by hand.
>
> The Issue asked for the local copy to be deleted before the revoke is
> enqueued. That ordering cannot exist — the endpoint takes the token as its
> argument — so the token is **parked** under a name nothing reads.
> `app.vault_secret` gates every read and `googleAccess` asks for
> `google.refresh_token`, which is gone the moment Disconnect is pressed.
>
> ### 🔴 Slack is disconnected and needs Grant — Issue #210
>
> **`verify:disconnect` really disconnected Slack**, deleting the bot token and
> signing secret. The suite called `app.hq_disconnect` outside a transaction
> for six services that were all refusals when the loop was written; 0350 made
> Slack and Telegram real, and the loop kept asserting the old refusal.
>
> Worse than losing Slack: the dangling vault references made
> `app.resolve_secret` raise, so **the worker returned http 500 and no duty
> ran** until the refs were nulled. Slack now degrades alone.
>
> Telegram survived by accident — 0350 deletes `telegram.chief_bot_token` and
> the stored name is `telegram.chief.bot_token`, so that branch has never
> matched a row and reports success anyway. Filed in #210 as a follow-up.
>
> **Grant must reinstall the Slack app** — full steps in #210.
>
> Every `hq_disconnect` call in the suite is wrapped now, refusal or not.
> `verify:disconnect` 30/30, 1,017 tests, worker deployed and draining.

> ## What changed on 2026-09-14 (evening)
>
> **The three Behaviour toggles were never broken (#111).** Including *"Only
> the Chief of Staff messages me"*, the switch behind
> `telegram.only_chief_speaks`. The audit was pressing the settings sheet's own
> **Close** button — it sits in `.chead`, so the collector gathers it first —
> and every control gathered after it still resolved with no box, which
> Playwright reports as `element is not visible`.
>
> Third instance of one shape: `shutDock` (#103) for the dock, `openRail`
> (#183) for the rail, and now `reopenSheet` for the sheet. *A sweep that
> presses every control will press the one that hides the others.*
>
> A second half was missed by #190: it scoped the COLLECTOR to whatever is in
> front and left the LOCATOR searching the whole document by label, so "Team"
> matched the rail's *Call the team* button behind the sheet on six routes.
>
> | | before | after #190 | now |
> |---|---|---|---|
> | settings, desktop | 12 pressed / 93 unpressable | 12 / 3 | **92 / 0** |
> | settings, phone | 12 / 75 | 12 / 3 | **92 / 0** |
>
> **0 findings on every leg**, and the other routes are unchanged: desktop
> studio 289/1, team 101/0 and 97/0, phone project 292/3, phone portfolio 13/1.
>
> No product change was needed. Two false findings were caught before reaching
> Grant: the toggles measure 58x52 in a real touch context (not the 50x29 a
> bare viewport reports), and the report's *"6 inert (12 of those are known
> stubs)"* was printing the allow-list's size rather than the run's.

> ## What changed on 2026-09-14 (later)
>
> **A message that is a list arrives as a list (#209, ADR-0028).** Grant:
> *"if our paragraph should be separated by bullet points, enumerated bullet
> points. So a numbered list, just to keep things easy to read and easy to
> refer to."* The word that matters is **should** — prose stays the default and
> #186 is narrowed, not reversed. Numbered rather than dashes, because
> *"easy to refer to"* means replying "do 2 and 4".
>
> Three system prompts carried the literal instruction `no bullet points` and
> now agree with each other. `src/projects/brief.ts` keeps its ban on purpose:
> a project brief is a document, not a message.
>
> **The larger find: #186's paragraph structure had never rendered on the
> dashboard.** `<p>${esc(m.text)}</p>` puts a whole body in one tag and HTML
> collapses whitespace, so the model was producing paragraphs, Telegram and
> Slack were showing them, and the studio ran every reply together into one
> block for as long as the studio has existed. Three green suites over it.
>
> An all-numbered block is now a real `<ol>` — line breaks alone were tried
> first and the phone capture refuted them, because at 390px the continuation
> of item 1 wrapped into the column item 2 began in.
>
> `verify:chat` **45/45**, up from 37, and the control was run: three of the
> four new checks go red on **both** device legs with the old rendering back.
> Two earlier versions of the fourth check were discarded for passing on the
> phone while the defect was live.

> ## What changed on 2026-09-14
>
> **An agent may not say it looked when it did not (#185, ADR-0027).** The P0.
> Claire told Grant at 03:45 that she had pulled the project records and that
> the database read showed five active projects; none of the five existed, and
> the output row said `evidence: inferred` — the office knew nothing had been
> read and rendered that knowledge as grey caption text underneath the claim.
>
> Two gates now, and they are not the same check. `metadataProblems` refuses
> the combination when the output is CREATED, which is the better place — the
> job fails while somebody can still act on it. `refuseToSend` refuses it again
> inside `combinedNotifier`, because `resumeNotifications` rebuilds an output
> from its stored row and sends it **without passing through creation at all**.
>
> The sending gate is deliberately narrower: it refuses the two things that are
> lies to the reader, and not the judgement pairings, because a guard that
> silences a usable answer at the last moment gets switched off. A refusal
> writes a `job_impediments` row through `app.cannot` rather than dropping the
> output silently — an output that vanishes between `committed` and a channel
> is indistinguishable from a job that had nothing to say.
>
> `evidence: verified` now also needs citations that are ADDRESSES. The first
> implementation was a whitelist of schemes and it refused `db:projects`; a
> whitelist fails whenever the office grows a source it did not have, and it
> fails by refusing to speak. It checks the shape now.
>
> `npm run verify:attests` — **10/10**, with the 03:45 message in it verbatim,
> and two CONTROLs at the end: the identical sentence IS sent when the read
> actually happened. A gate that refused everything would pass the first eight
> checks and look exactly like the rule working.
>
> **`verify:worker` had three unscoped dequeues left after #184.** Reached only
> when the office happens to have work queued, and today it did: the
> concurrency pair claimed a real `drive.watch` job, `runJob` threw
> `NoHandlerError`, and the suite died four sections early with a duty's work
> leased to a fixture worker. *A scope that covers most of a file is not a
> scope.* Now **28/28** on a clean queue.
>
> **The Telegram message stopped introducing itself (#208).** Grant, on a
> screenshot: *"I don't need to see the contact's name and the message. I
> already have it... just see conversation rather than unnamed."* The sender
> line and the trailing project footer are gone, `Unnamed` reads as
> *Conversation*, and the provenance line only appears when it attests
> something — which keeps #185's protection rather than deleting it.
>
> **Telegram is one bot (#70).** Seven staff bots disabled with a stated
> reason; the pager is Claire's.

> ## What changed on 2026-09-13
>
> **Slack stopped sounding like a database (#186).** Grant sent three
> screenshots of his own workspace: *"how much space is being taken up... It's
> really not intuitive or acting like it's a human... you'd really need to work
> on it looking a lot better, making it obvious what things are related."* Four
> defects, all found by reading his real traffic rather than the source:
>
> - a routine read wore a finding's clothes — *"Looked at 1 Drive folder.
>   Nothing new."* carried a confidence caption and a row of feedback buttons,
>   270 times in ten days. A deterministic output now carries neither, and the
>   rule is about honesty rather than space: a message says how much to trust it
>   exactly when there is something to decide;
> - nothing was related to anything — thirty-one real questions in
>   `#ai_team_hq_test` with not one reply attached. An answer now threads under
>   the message that asked, and is broadcast so threading does not take it off
>   the channel;
> - harness traffic was on the floor channel (*"Filed under zz test slack
>   80106050"*);
> - and the floor said *"the a question is about evidence"*, because the
>   vocabulary substitution was translating four §6 class names that are already
>   English words.
>
> **Project Settings exists (#36, ADR-0023).** The last unbuilt child of #25,
> four panes at `Settings` in every project's rail:
>
> - **Team** — who works here, and what each is told here. Absence means
>   everyone; the table records departures from that default, and the Chief of
>   Staff cannot be taken off. It takes effect in `pickRoster`.
> - **Automations** — a standing instruction, addressed to one of the team, on a
>   schedule, created and paused and removed entirely in the UI. No new table:
>   `responsibilities` is the automation table and had never had a writer.
> - **Labels** — the contact labels, editable in the same place as in Contacts.
> - **Project** — export the whole project as §13's neutral package, and archive
>   it reversibly.
>
> Migrations 0323–0328. Everything is reachable over HTTP and
> `verify:settings` drives that chain including the browser layer.
>
> **Phase 7 has started: #192 is built (0334–0337, ADR-0025).**
> `app.conversation_history(project_id, limit, before)` returns one project's
> conversation, both sides, in order, whatever surface each message arrived on,
> at `hq-api?section=conversation&id=<project>`. `verify:history` drives the
> whole chain including HTTP, 24/24.
>
> **There is no conversations table**, and that is the decision to argue with
> rather than discover. `public.relations` is six migrations back in CLAUDE.md's
> trap list — the edge table that never held a row while six columns held the
> same facts — so the history is DERIVED from `inbound_commands` and `outputs`.
> The one fact no column expressed was `inbound_commands.project_id`: 57 of 251
> commands have no job at all, so a fifth of everything Grant has said could not
> be attributed anywhere. ADR-0025 names the signal that would make a
> conversations table earn its place: a requirement for more than one thread per
> project, not a feeling that the model looks thin.
>
> Adding one fact took three migrations and two of them were defects caught by
> the suite. 0336: `enqueue_inbound` resolves the job's project separately, so
> one exchange could split across two conversations. 0337: it then had to READ
> the column, which 0335 and 0336 had left write-only — 0298's `web.search` with
> the sign flipped, and the studio sending from a project page would have been
> misfiled from the day it shipped. Found by printing where the job actually
> landed; the earlier check asserted only that command and job AGREED and passed
> while both pointed at the wrong project. **Agreement is not correctness.**
>
> 0334 also creates the reserved **Unnamed** project (ADR-0024) and the
> protection it needed: `projects.reserved_reason`, and `project_delete` refuses
> a row carrying one. It is not `is_fixture` and is deliberately not named
> anything beginning `untitled`, because `check:leaks` sweeps
> `untitled-notebook-%`.
>
> **Also found, and corrected in the plan:** most of #195 already exists.
> `inbound_commands.dedupe_key` is NOT NULL, UNIQUE and shaped
> `<surface>:<kind>:<id>`; `deliveries.dedupe_key` is unique too and
> `deliveries.message_ref` already holds the external id of everything the
> office has sent. What is genuinely left there is loop prevention, not identity
> or dedup.
>
> **Phase 7 — the rest is planned, not started (#191).** Grant's
> 13 September brief said GitHub is the durable memory and nothing important
> may live only in a conversation. The brief is stored verbatim at
> `docs/spec/github-persistence-brief-2026-09-13.md` and its twenty-six
> requirement topics are now eleven Issues under **#191**, with a Prompt
> Persistence Audit mapping every topic to its home.
>
> The inspection pass found more substrate than the topic list implies —
> `inbound_commands` (0011) has every message he has ever sent, `slack_channel_map`
> (0014) holds project-to-channel in Postgres rather than a channel topic, 0198
> already reads both sides back for recall, and 0102 puts voice through the same
> canonical layer. **The gap that decides everything else: there is no
> `conversations` table and no `messages` table.** His side is in
> `inbound_commands`, the office's in `outputs`/`deliveries`, and nothing joins
> them into one ordered history. #192 is that model, and #195 (message identity,
> deduplication, loop prevention) has to be right before any second surface is
> connected — otherwise the office echoes itself.
>
> **Three decisions answered on the day, in ADR-0024.** Only the Chief of Staff
> posts unprompted in a project's Slack channel, but Grant may address any
> individual and gets that person's reply — a stored preference, not a
> constant, because *"for now"* is load-bearing in how he said it. A Telegram
> message naming no project lands in a reserved catch-all dashboard project
> rather than a nullable `project_id`. And Slack sync is convergent: two
> windows onto one history, never a mirror.
>
> Two of those have traps written into the ADR because they will otherwise be
> got wrong. Applying the Slack voice rule uniformly suppresses the reply Grant
> asked for **and looks exactly like the rule working**. And the catch-all
> project will be swept — `check:leaks` already matches `untitled-notebook-%`,
> so despite his phrasing it must not be named anything beginning `untitled`,
> and there is no protection column on `projects` today.
>
> Two things worth knowing before picking this up. First, **the brief contains
> the topic list and not the specification behind it** — no acceptance criteria,
> no wireframes. Each Issue states what it inferred and where a different
> reading would build differently; several would go materially wrong on a
> plausible alternative. Second, accessibility (#200) is a genuine hole: ninety-four
> open Issues and not one about it, beyond the contrast and type-size checks in
> `verify:layouts`.
>
> **The space-usage critique pass, and a tool that answers its question
> (#85).** The Issue asks for measurement rather than squinting, and it was
> right to: three of four findings read off the capture were **wrong** — the
> rail is 880 of 900px used, the #108 fade is on at `opacity: 1` on every
> clipped panel, and the phone's "clipped" title has 20px of clearance at
> `scrollTop: 0` (it is the capture's own scroll). Two survived.
>
> A panel header was **53px of a 300px panel for a 16px label**, because 28px
> of it was the resize controls — which are `opacity: 0` until hover. #67's
> trap in a second place. Absolutely positioned now: **53px → 33px**, 120px of
> content back on one Overview screen, and Documents and Lately stopped
> clipping at all.
>
> On a 390×844 phone the first pixel of project content was **703px down —
> 83% of the first screen furniture**, and 51px of that was a sentence telling
> you to drag panels on a viewport where `.panel { position: static }` and the
> drag is deliberately switched off. Hidden there: **703px → 632px**.
>
> `npm run space` is the new tool. It reports only — no thresholds — and prints
> each panel's header share, whether the fade is actually on per panel, how
> much of each container is empty, and how far down the first content pixel is
> with everything above it named. `probe` answers "how big is this box";
> `space` answers "which of forty boxes is spending the room".
>
> Still open and deliberately not touched: the phone is 75% furniture on its
> first screen, `.projhead` being 135px of it. That is a compositional fix (a
> collapsing head, or the crew and toggle moving into the sticky bar), not a
> padding edit, and shrinking the parts individually is the densification the
> Issue warns against.
>
> **Two suites no longer need the whole queue to themselves (#184, ADR in
> 0329–30).** `verify:slack` and `verify:worker` both refused to start while
> any job was live anywhere, because dequeue is global — so in a full pass
> whichever ran second failed on the first one's debris, as "22/26" rather than
> as "the queue was dirty". `dequeue_job` gained `p_requested_by`, which
> narrows both the claim and the capacity question to one scope. Both
> directions now pass back to back with no purge between them.
>
> **The control audit had been blind to half the product, and the recorded
> explanation was the wrong one (#183).** 91 of 182 desktop controls
> unpressable, the same thirteen every route, the entire left rail — while the
> phone leg skipped two. The cause is one press: the sweep presses the chevron
> that collapses the sidebar, the studio REMEMBERS that in `localStorage`, and
> every rail control after it is behind `main`. The buttons still resolve,
> because a collapsed rail clips them rather than removing them, which is why
> it read as an actionability mystery. Found by keeping the actionability log
> that `catch {}` had been discarding — two reasonable fixes tried before that
> (force-clicking, a taller viewport) changed nothing and were reverted.
> **13 unpressable → 0** on the first route measured.
>
> **Three audits were looking somewhere other than where Grant looks.**
> `verify:layouts` ran without a token, so it had never measured a single
> writer control — given one it found sixteen touch targets under 44px and a
> 13px input, all years old. `verify:wired` read a hardcoded list of nineteen
> filenames, so the twentieth module was uncovered by construction; it walks the
> directory now. And `verify:controls` wrote its report to a path built from its
> own route filter, so a run filtered by a route containing a slash lost
> everything it found.
>
> **One frontend, and it is the designed one.** `ai-team-hq.vercel.app` serves
> `web/studio`; `web/hq/index.html` is deleted (ADR-0019, #68). Every write
> action, all six operational sections and the voice call moved across, and the
> suites moved with them — `verify:ui` walks nineteen studio screens at three
> sizes, and `verify:design` fails if a second frontend ever reappears.
>
> **The office now learns, notices and can be taught.** `app.notice()` finds
> what nobody asked about — an unowned deadline, a quiet project, a source that
> gave nothing, a limitation that recurred — and a dismissal buys a fortnight of
> silence per dismissal rather than lowering a score. It feeds the morning
> briefing's recommendations, which arrive daily at 07:00 Athens. And skills are
> data: Grant can tell the office a procedure in a Telegram message and it goes
> in front of the relevant work from the next job on, visible and retirable on
> each person's card. **A skill may name a tool and may never name an address**
> (ADR-0017) — that one rule is what makes a procedure safe to let an agent
> write, and `app.staff_may_use()` reads neither skills nor lessons, asserted
> behaviourally and structurally.
>
> **Overnight, 11–12 September.** Twenty-seven of the thirty UX-review items
> are closed, plus #11 and #24 which turned out to be blockers. Google Calendar
> sync is built and **switched off** — turn it on at Settings → Behaviour →
> *"Put dated tasks in my Google Calendar"*. Everything else is live.
>
> The last five of that night: **#103** the dock — a fixed column that keeps a
> conversation with the team open while you move around, reaching `/voice/turn`
> like the call does · **#81** dashboard arrangements now live in Supabase
> rather than `localStorage`, which is **ADR-0021** and the rule for everything
> customisable after it · **#90** Disconnect works for Notion and NotebookLM as
> well as Google, refuses honestly where there is no safe disconnect, and says
> where to revoke at the provider because Postgres cannot · **#108** dashboard
> panels stopped clipping their own content mid-word · **#107** a contact shows
> the labels its role already names, so no chip reads zero beside somebody who
> plainly belongs in it.
>
> Two things to know before reading further:
>
> - **`calendar.sync_tasks` is false on purpose.** It works end to end,
>   verified with one controlled round trip against the real diary. A task that
>   becomes done has its event **deleted** without asking — only ever events
>   carrying our own task id (ADR-0020). That is the one decision worth your
>   eye before you flip it.
> - **`public.tasks` had zero rows and no way to make one**, which is why #11
>   got built ahead of the calendar. A calendar sync over an empty task table
>   would have been #72 exactly.
>
> **Grant's UX review of the studio is filed as #75 and half-built.** Thirty
> items, persisted verbatim at `docs/spec/ux-review-2026-09-11.md` and filed as
> #76–#105. Fourteen are closed: the navigation is his shape now (picker top
> left, sections in the sidebar, Lately and Settings at the bottom, no status
> strip, no Desk, the rail collapses to nothing), the covers are 64px marks
> rather than slabs, light and dark is a real three-state setting, and the
> connect buttons connect.
>
> Two of them were worse than described. **#102 was not "off does not work"**:
> closing the call sheet threw away the only reference to a live microphone,
> so nothing could ever stop it and reopening started a second. **#87 could
> not have been fixed as written**: there was no dark-mode setting to fix —
> every palette's dark tokens lived only inside `prefers-color-scheme`.
>
> **Six new checks, each written because something passed while broken.**
> `check:templates` parses every `web/**/*.js` as a module and refuses a
> backtick in an HTML comment. `verify:wired` fails on a control no source
> file looks up. `verify:talk` now counts live audio tracks across every
> stream the stub handed out, including ones the page has forgotten.
> `verify:layouts` fails when a box hides content and gives the eye neither a
> real scrollbar gutter nor a marker — the third clipping-class defect a green
> suite had missed. `verify:arrangement` asserts what LEAVES the page, because
> a layout saved only to `localStorage` drags, snaps, survives a reload and
> captures perfectly, and is wrong only on the second device. And
> `verify:disconnect` checks a destructive action **without being
> destructive**: every SQL assertion runs inside `begin … rollback`, the page's
> own payload is read back inside the transaction, and it then re-asserts that
> the real credentials are still there.
>
> **Each of the three new suites was proved by putting its bug back.**
> `verify:layouts` reported 2192px of Documents hidden with nothing to say so;
> `verify:arrangement` went to 1/6; and `verify:disconnect` needs no such
> demonstration because it deletes a real credential and rolls it back on
> every run.
>
> **The backlog is current as of 11 September.** Every issue verified complete
> was closed with the evidence in a comment rather than a tick — #9, #48, #52,
> #53, #55, #56, #57, #58, #59, #61, #62, #66, #68. **#50 stays open on
> purpose**: six of its seven boxes are ticked and the last one — a real
> capability acquired end to end without a coding session — needs the office to
> ask for a tool it does not have and be granted it. Five findings from that
> day's work that were in nobody's Issue are now filed: Claire is the only
> agent with no bot of her own and the only one permitted to speak to Grant
> (#70) · modules are in the canonical IA with no table behind them (#71) ·
> *build the mechanism, forget the mouth*, five instances in one session, which
> wants a check rather than another note (#72) · the backtick-in-a-template
> -literal trap fired five times in a day despite being documented (#73) ·
> `verify:controls` audits the studio without a token, so it cannot see a
> single write control (#74).
>
> **Recently landed:** the frontend build prompt persisted to
> `docs/spec/` · integration assessment · GitHub as the operational record
> (19 labels, 5 milestones, templates, 14 Issues) · the Notion document
> duplication fixed at the root (#8) · phone notifications (`npm run notify`) ·
> the build diary (`npm run step`, visible at *What Claude is building*).

# Start here

**For the next session, human or otherwise.** This replaces every earlier
handoff; the dated ones remain as history and you do not need them.

**Branch:** `claude/phase-7-communications-kh8ow8` — everything committed and
pushed. **Written:** 2026-09-05, revised 2026-09-09.

**Starting a new session or a new environment?** Read
[`new-environment.md`](new-environment.md) first — it is four commands and the
two variables an environment needs, so the first thousand tokens go into work
rather than rediscovery.

---

## Read these four, in this order

1. **[`known-problems.md`](known-problems.md)** — everything currently wrong.
   Start here, not with the code.
2. **[`adr/0013`](adr/0013-the-project-is-the-source-of-truth.md)** — the
   decision that settles the knowledge layer. The project is the source of
   truth; NotebookLM, Notion and uploads are connectors to it. Read it before
   touching `documents`, and do not revive the NotebookLM sync.
3. **[`../AI_TEAM_HQ_MASTER_SPEC.md`](../AI_TEAM_HQ_MASTER_SPEC.md)** — canonical,
   supersedes everything.
4. **[`defects-fixed.md`](defects-fixed.md)** — every defect found and closed,
   and the one shape of mistake that keeps arriving in a new costume.
   [`test-evidence/`](test-evidence/) has the long-form accounts. The seven
   habits at the end of [`new-environment.md`](new-environment.md) are the
   distillation; read those even if you skip the list.

Then run `npm run inventory` before trusting any credential.

---

## Where it stands

**Revised 2026-09-09.**

| Phase | |
|---|---|
| 0–6 | ✅ complete |
| 7 · communications | ✅ complete. All eight bots exist, answer, wear their own face, and write in a voice a person would use |
| 8 · Team HQ | ✅ deployed and redesigned — grouped menus, plain English, and a real voice call on the Talk page |
| 9 · Google ecosystem | ✅ Calendar, Gmail, Drive and YouTube connected per-service; calendar and mail have readers and refresh hourly |
| · knowledge layer | ✅ ADR-0013 built. Notebook reads AND writes now run over HTTPS with no subprocess (0138, 0140); Notion has a duty as of 0146 |
| 10 · hardening | ✅ §18 covered including case 7; both §22 scenarios harnessed and passing; backup taken nightly and restore rehearsed |
| · the office acting | ✅ an instruction becomes work, is said back before it runs, and every generation is gated on Grant |
| · MCP | ✅ read and write, with OAuth for ChatGPT's developer mode |
| · recurring duties | ✅ seven live: capacity report, calendar, mail, discovery, Notion, Slack token rotation, nightly backup. One left disabled — `vault-export`, which needs Grant |

304 migrations · 976 unit tests · ~67 live suites, all green.

**The Governance page shipped with harness debris on it, and it is fixed
(0303-0304).** An hour after #54 went live, a status sweep found Ruby's card
reading *"probe-need-j4je9xrc — the office has no such tool — 8x"*: five rows of
`verify:proposes` debris on the surface built to make the office legible, which
is the exact trap `jobs.is_fixture` exists to prevent. `app.office_health()` was
separately reporting fourteen stalled research jobs from the same crashed run.

The cause is worth keeping: `job_impediments.is_fixture` is a copy taken from
the job by trigger at insert, and §6 then refuses UPDATE — so once the job's
attribution was corrected, the copy stayed wrong for ever. The tally now asks
the job as well, whose `is_fixture` is generated and always current. The first
attempt used `coalesce` (job first, copy as fallback) and put two rows BACK on
the page, because their copy said fixture and their job said real; the rule is
that **either witness may exclude and neither may include**, so it is `or`
(0304). Nothing was deleted — all 105 impediment rows are still on the ledger,
41 of them visible through `p_include_fixtures`, and none counted as work.
`verify:governs` is 24 checks now: one asserts no name on the page matches a
probe pattern, and one asserts the two-witness rule directly.

**Grant can see what the office learned, and change it (#54, migration 0302).**
The last child of #46, and the one that makes the rest of that epic safe rather
than unnerving: with #48 landing, behaviour changes for reasons that live in a
table, and a table nobody surfaced removes his ability to tell a system that is
getting better from one that is drifting. A **Governance** tab now sits beside
Behaviour in the settings sheet — a sibling rather than part of it, because
Behaviour is eight switches and this is four lists, and folding them together
makes both harder to use. It answers four questions from one call,
`app.hq_governance`:

- **what it learned** — every live lesson as a quotation, with its scope, the
  project or person it applies to, who learned it, and the job it came from.
  `app.retract_lesson` writes a RETRACTION row that supersedes it: `lessons` is
  append-only, so nothing is deleted, the reason is recorded next to it, and
  "why did it change" stays answerable. Retracting twice is a no-op; retracting
  a retraction is refused by name.
- **what it wants** — open proposals first, then anything settled in the last
  thirty days, each approvable or declinable in place with the argument and the
  cost on it. **The decline is the durable half**: `proposals_one_per_need`
  means the same need cannot be raised again while the row stands, which is
  what stops a boundary becoming a nag. Reopening is allowed and is always a
  person's decision.
- **what it noticed** — suggestions with their outcome and their dismissal
  count, because a thing offered four times and dismissed four times is the
  office failing to take a hint. `suggestions.because` is JSONB — the numbers
  the noticing pass counted, not a sentence — so it renders as counted facts.
- **what each of them can do** — remit, tool count, and the list of walls hit
  in ninety days from `app.impediments_tally`. #54 calls that last list the
  most useful thing on the page and it is right.

`verify:governs` is 22 checks, and it tears itself down through the feature
under test: the lesson it writes is retracted, which is the only removal an
append-only ledger allows, and the assertion that the payload no longer carries
it is the same assertion that proves the teardown worked.

**Three audits were pointed somewhere new and found five things.** #54's
acceptance says it must pass `verify:ui`, `verify:layouts` and
`verify:controls` — and `verify:layouts` had never opened the settings sheet at
all, which is the "a verification that looks somewhere other than where the
user looks" trap in its purest form. Extending it to `settings/governance`
(52 states now, from 38) immediately found: `--ink-3` failing WCAG AA at 12px
on five palettes; the settings sheet hiding 2,857px on a phone behind an
overlay scrollbar with no affordance at all — #108's defect, still live, on
every settings tab; and a false red of its own, because the studio scales the
shell to 0.994 behind an open sheet and a 44px button therefore measures 43.74.
The first two are fixed, the third is fixed in the audit. `verify:ui` now feeds
the governance pane real rows at all three sizes, and `verify:wired` walks
seventeen screens rather than sixteen. `verify:hq`'s tool control was also
repaired: it asserted that `web.search` could be revoked and re-granted, and
0298 had switched `web.search` off — a control that must fail on a change that
was correct.

**Every connector says what it can do, and what we never ask it for (#51,
migrations 0300-0301).** `knowledge_connectors.notes` was prose written for a
person; an agent cannot ask prose whether it can recover an audio overview.
`public.connector_capabilities` is one row per verb — 24 across six connectors —
with `reach` (`api` / `unofficial` / `browser_only` / `none`), what it costs,
what in the office uses it, and `verified_by` saying whether that is known from
a probe, a suite, or merely declared. The negatives are in it deliberately, as
#51 asks: Notion has no teamspace on any version, Drive is read-only by scope,
GitHub write is disabled at risk 3. `app.unused_capabilities()` is the gap as a
QUERY rather than an opinion — today it returns exactly one honest row, that the
office can create a note in a notebook and never does — and `capability_index`
carries it as `could` so it reaches the prompt. Only the gap, not the whole
sheet: 24 verbs on every prompt would cost more than they are worth.
`verify:sheets` (14 checks) proves the NotebookLM rows claiming a probe are
backed by the actual probe output, and that a verb moves in and out of the gap
when the office stops and starts using it.

**The office gained a capability without a coding session (#50, migrations
0298-0299).** The epic's own acceptance box, done rather than simulated: Emma
authored *"Research a topic with the reach we already have"* through
`app.teach_skill` — no migration, no deploy, no handler — and it comes back from
`app.skills_for` on her next job with `missing: []`, because it was written
against reach she actually holds. Found on the way: **`tool_permissions` listed
`web.search`, level 0, ENABLED, and nothing implements it** — so every agent's
sheet told it that it could search the web. That is #64 with the sign reversed,
and reversed is worse: being told no about something possible costs a feature
request, being told yes about something impossible costs the work, silently.
0298 adds `delivered_by`, fills it for all fifteen real tools, disables
`web.search` with the reason (disabled and NOT deleted — a listed gap can become
a proposal, a deleted one cannot), and adds a constraint so an enabled tool must
name what performs it. `npm run verify:acquire` (11 checks) proves the whole
chain including the half that makes it safe: authoring a skill that names
`web.search` and `spend.money` changes nothing about what the agent holds, and
`staff_may_use` still refuses.

**The office says what it understood, and asks for what it needs (#47, #49,
migrations 0295-0297).** `jobs.understood_as` is the agent's own one-sentence
reading, written BEFORE acting and write-once — a wrong reading is invisible
until it is written down, because an output built on a misreading looks like a
perfectly good output. `public.proposals` is #49's core object: a ROW, not a
message, because a message cannot be declined, only ignored and sent again on
Thursday. One row per (agent, kind, need) FOR EVER — the unique index IS the
durable decline — with a remedy, an argument carrying the count, and a state.
`app.raise_proposals` reads `impediments_tally`, so noticing costs a SQL query
rather than a model call per job, which #49 requires; a declined proposal is not
reopened, not re-counted and not re-delivered. Claire batches through
`app.proposals_to_send` and stamps `delivered_at`, so nobody else speaks and
nothing sends twice. `npm run verify:proposes` (19 checks) drives four identical
failures, asserts ONE proposal with a count of four, declines it, drives four
more and asserts silence. 0297 exists because the suite could not tear itself
down: `job_impediments` is append-only by §6, so the subjects had to become
fixtures — permanent but excluded from every real tally — and `raise_proposals`
gained the `p_include_fixtures` parameter its own tally already had. Five
proposals raised from older harness debris were **declined**, not deleted: the
ledger is append-only and declining is the mechanism for permanent silence.

**An agent knows what it can do (#64, `verify:knows`).** Claire told Grant *"I
cannot add interactive Telegram buttons; I only generate plain text"* — false
when she said it, and he went and asked for a feature he already had. The two
mechanisms (`capabilityBrief` in the prompt, `contradictsReality` as the net
under it) were already built; the proof was not, and the third box was open.
The suite asserts his exact sentence is caught, six other wordings of the same
claim, and — the half that decides whether the guard survives — six TRUE
sentences it must not fire on, because a net that catches honest answers gets
loosened and the bug comes back. `notebook_capability` reported three read
capabilities while `act.py` creates notebooks and generates audio, so the probe
now also reports what the adapter OFFERS, checked by asking the client whether
the method exists rather than by creating a notebook on every run — named
`offers_*` so a reader can tell which half was exercised and which was only
found, and deliberately unable to promote the probe's state.

**Delegation leaves a trace (#65, migration 0294).** Re-measured against the
Issue's own numbers: jobs addressed had moved from 0/499 to 9/856 and four of
those went to a specialist, so the CHOOSING was real — but `consultations` was
still 0 and outputs with no author had gone from 140 to 1,060. The reason for
the first: the hand-written INSERT passed a `text[]` and a slug where two UUIDs
belong, so it raised on **every** hand-off, and the call site ended
`.catch(() => undefined)`. A swallowed error on a write nobody reads back is
indistinguishable from a feature that was never built. It goes through
`app.record_consultation` now, which takes slugs and does the resolution once,
refuses consulting yourself (which would make the rate look healthy) and a name
nobody answers to; a refusal is recorded as an impediment rather than
discarded. `app.judge_consultation` fills `changed_outcome` from the review the
output already gets, and records in `outcome_note` what it inferred it from, so
weak evidence is not later mistaken for strong. An output with no author now
takes the job's `recipient_agent` by trigger rather than by editing 28 handlers
— history is deliberately NOT backfilled, because nothing recorded who wrote
those and a name Grant would read as fact is worse than the gap.
`app.delegation_health` answers the Issue in the numbers it was filed with, and
`npm run verify:handoff` reports the rate rather than asserting a threshold.

**Claire has a conversation, and says back everything she was asked (#63, #60,
`verify:conversation`).** Both mechanisms were built in an earlier session and
neither had a proof, which is why both Issues stayed open after the code landed
— this repository's own #72 pattern with the halves swapped. The suite is the
last box on each: a two-message exchange where the second is understood in terms
of the first, and Grant's 11 September voice note replayed verbatim with all six
clauses accounted for. Nothing needed fixing in the office; two of the suite's
own checks did — one asserted `create_project` where the planner correctly emits
`project` (the handler decides its fate later), and one was written so it could
not fail.

**Project switching works, and three bugs were hiding behind one red check
(#177, migrations 0291-0293).** `verify:agents` was 50/53 on "project
switching", and the issue was right to insist on diagnosing before fixing: it
was **both** of its candidates plus a third nobody was looking for. The suite's
subjects were `fixture-` named and `app.current_project` deliberately refuses a
fixture (0164), so every check read `resolved=null` against code that partly
worked — #45's trap again. Behind that: 0164 had added the fixture guard by
retyping the function from memory and dropped 0026's `order by switched_at desc
… limit 1`, so **clearing a project context did nothing** (an inner join drops
the switch-to-NULL that un-scoping is, and the previous project persisted for
ever), "the latest wins" was whatever the planner returned first, and the guard
fell back to an older switch instead of declining. 0292 then let
`app.project_delete` sweep the switch log, without which a project that had ever
been the subject of a conversation was undeletable — and said so with the raw
constraint name 0282 exists to avoid. 0293 is the same shape one table over:
0282 loosened the alias uniqueness to ACTIVE projects to release 561 phrases,
and `app.add_project_alias` — the only writer anybody calls — still pre-checked
against all of them, so the release was unreachable from the day it shipped.
`verify:agents` is 56/56 and `verify:identity` 30/30.

**What is waiting on Grant is where the work is (#151, migrations
0289-0290).** The landing page has shown "2 things waiting on you" since 0240;
inside a project — where he could actually deal with it — it showed nothing,
because `hq_studio` reduced `needs_me` to one item for the banner and threw the
rest away. Now `app.studio_waiting` per project, in the header, above the
sections, collapsed to a line until pressed and absent entirely when nothing is
waiting. The third bullet had no mechanism at all: `answer_generation_approval`
did one kind and every other blocker could only be discussed, so
`app.hq_answer_blocker` is the general answer — refusing anything the blocker
did not offer, delegating to the generation path where that is what it is, and
releasing the job it was holding. 0290 is the bug `verify:waiting` found on its
first run: `waiting_user -> queued` is not a legal transition, and the legal
road is `paused` then `queued`, which is also the honest one — both hops land in
`job_state_transitions`. `npm run verify:waiting` is 21 checks and writes three
captures; opening one of them found the second bug, that an overdue item was
indistinguishable from a calm one on a bar with two rows.

**A time on the page stays true while the page is open (#153, migration
0288).** Every "3 days ago" was computed in SQL when the payload was built —
harmless when a page lived for a minute, and quietly wrong now that #117's
watcher keeps the studio open all afternoon. The projections carry the instant
beside the rendered string (`at`, `lastAt`, `askedAt`, `deliveredAt`), the words
are made in `web/studio/when.js`, and `pulse.js` re-makes them on the tick it
already runs — no second timer, and `retime()` sits ahead of the `running` guard
because a slow fetch holds it across exactly the minutes when the times go
stale. The rendered string stays as the fallback, which is what made this safe
to roll through the projections one at a time. `tests/studio/when.test.ts` pins
every boundary; `npm run verify:times` proves the wiring by leaving a real
browser open, moving its clock two hours, and reading the same element again —
with a control that the clock alone changes nothing, and a check that stopping
the watcher stops the times, so a second timer could not hide.

**Modules are real, and are not a new table (#71, migrations 0286-0287).** The
Issue asked for `public.modules`. The canonical IA it cites does not contain the
word; the frontend prompt uses it for the dashboard's PANELS, which #81 built.
The section the studio actually renders is a third thing — numbered, named parts
of the work with a state and counts — and **every piece of that already existed**:
`tasks.is_milestone`, `tasks.priority`, `tasks.parent_task_id`, `collections`.
So a module is a milestone task that gathers documents, the one missing join is
`collections.for_task_id`, and `app.studio_modules` derives the rest at read time
so a count cannot drift from what it counts. `hq_task_add` learned `p_milestone`
(0287, dropping both halves by exact signature first — the public wrapper is the
one that silently drops a new parameter), so making a module is one call rather
than add-then-promote. `npm run verify:modules` is 16 checks against a subject
built with decoys: a fixture child, a grandchild, and a collection that is
nobody's shelf, each of which a plausible join would count.

**Contact labels and custom fields are the office's, not the browser's (#110,
migration 0285).** The last thing in the studio on the wrong side of ADR-0021 —
a label Grant invented on the laptop was not there on the phone, and one cleared
browser lost the lot. `contact_labels`, `contact_label_links` and
`contacts.fields`, keyed on `contact_id` and never on the name (which was wrong
the first time two people share one). #107's derived labels survive with both
their rules intact: `contacts.labels_set` is what tells "no labels" from "never
touched", because an absent link row says both and without it a label he removes
comes straight back. Both writes replace the whole value rather than applying a
delta, which is 0250's shape for `p_panels` and gives #118's undo an exact
inverse — `hq_undo` learned all three reversals in the same migration, since
recording an inverse it cannot perform turns Undo into a button that consumes
the offer and does nothing. `verify:arrangement` grew seven checks, the last of
which is the one that matters: after every write, `localStorage` is still empty.

**The corpus holds material and nothing else (#19, #20, migrations
0283-0284).** `duty:notion-sync` stored two things that were never source
material. The three databases the office WRITES into — Projects, Tasks and Docs
— were ingested as documents, each one a bulleted index of its own rows that
matched a search for any row title and re-synced whenever anything was renamed;
a Notion object whose id is in `project_attachments.external_ref` is now the
attachment, not a document in it. And the six module pages
`office.notion_import` authored were read straight back and counted as material
Grant supplied. #20 asked whether `documents` needed an origin column — it
already has one, `yours | source | made`, and the bug was that 0178 DERIVED it
from the connector, which stopped being the definition the moment the office
began writing into a connector and reading its own work back. `origin` is
provenance, `connector` is location, and `notion-import` now states the
provenance in the same pass that creates the page. `npm run verify:corpus`
drives the sync against a stub Notion that presents both shapes, and proves
each invariant by first planting the broken row. 0284 is the bug that found:
`documents.produced_by` was NOT NULL defaulting to `''`, so the `coalesce` in
every reader was dead and a made document rendered with a blank origin line.

**Since 2026-09-11 the studio can take things back (#118, migrations
0263-0266).** Every write with an EXACT inverse records it at the moment it
still knows the previous value — a rename, a task edit, a state change, an icon
or hue, an arrangement, a detached source — and a strip offers to reverse it.
Everything else offers nothing and says why: a replaced project photo, a
disconnected service (the credential is deleted from the Vault), a new project
(the confirmation is the safeguard). `npm run verify:inverse` proves the
exactness per action against the live database, and carries a control that
records a deliberately WRONG inverse and requires the same comparison to catch
it.

**A write-capable job now says what it would do before it does it (#131,
migrations 0267-0269).** `Handler.plan()` is computed by the same code path that
performs the work — `syncTasksToCalendar` was split at exactly that seam — and
the worker records it against the job before the handler runs, at one
chokepoint. `app.request_approval` appends it to the blocker, so an approval
shows the list rather than the category. `npm run verify:dryrun` runs the
planner with a `fetch` that throws on any outward write, then runs the handler
with one that counts, and fails a handler that does more than it planned. Not
yet covered: `office.notion_import`, whose plan depends on a model call and so
needs the STORED plan to be the thing executed.

**A queued job is no longer invisible (#112, migrations 0270-0271).** Nine
hourly jobs sat queued for eight hours with a green dashboard, because
`office_health()` counted complete, failed and in-flight and a job nobody has
taken is none of those. `verify:worker` now holds the kinds enabled duties
enqueue against the kinds the real registry declares — `buildPass` exposes them
— and fails before a deploy rather than eight hours after.
`app.jobs_stuck_queued()` measures a stall against the period of the duty that
made the job, `office_health()` reports it, and the studio shows an orange strip
naming the kind and the age.

**An output can declare its shape (#130, migrations 0272-0273).**
`public.output_shapes` holds the contract as rows — one authority, because the
validator has to run where the row is written and every consumer is SQL — and a
trigger refuses a declared shape whose facts do not match, naming the key and
what it should have been. `body` stays: prose is what Grant reads. The duties
that report "nothing changed" now say so in a field. Still prose-only:
`research_summary`, `tasks_extracted` and `draft_document`, which need their
handlers taught to ask the model for structure.

**The office knows what it can do, per person (#148, migrations 0277-0279).**
`app.capability_index(staff)` is generated on every call from
`tool_permissions`, `staff_tools`, `knowledge_connectors`, `connection_health`
and `tool_requests`, and answers four different questions — can / must ask /
nobody may / already refused. It replaces `verbsNow()`, a hand-written list in
TypeScript that covered three of twenty-one tools; the verbs are a column now,
so the office can correct one without a deploy. It also fixed a duplicate that
had been in **every capability brief the office had ever sent**: Slack and
Telegram each have two `connection_health` rows and the surfaces branch never
deduped.

**Tasks exist across the whole portfolio (#173, migrations 0280-0281).**
`tasks.project_id` is nullable, so a task can belong to no dashboard project;
`app.hq_portfolio_tasks()` aggregates every open one with overdue, waiting,
stale, unowned and suggested computed on read in Grant's timezone; and the
studio has a Tasks screen whose first row answers *"what should I be doing
next"* rather than only listing. Ticking one there is the same row the project
view ticks, so undo works for free.

**The office recognises a failure it has seen before (#132, migrations
0274-0276).** `failure_signatures` counts a repeat instead of logging it again,
and `app.notice()` raises one that has happened three or more times in a
fortnight — *"this has failed the same way eleven times"* is a recommendation.
Deliberately not a circuit breaker: recognising a repeat and refusing to try
again are different features, and the second silently stops work Grant expects.

The table is **provably free of payload** because it has nowhere to put one —
no text column an error message could be written into, only a dotted kind, one
of nine class words, and an id. `verify:failures` attacks that rather than
asserting it, and found a real hole on the first run: a Slack-token-shaped
string satisfied the original subject pattern completely. 0276 narrowed it to a
UUID or a short lowercase handle AND held it against the credential shapes.

**There is no cron and no GitHub Actions.** Grant switched Actions off on
2026-09-08 — *"for any process"* — and everything scheduled moved to
`pg_cron` poking a Supabase Edge Function every minute, which then fires
whatever duties are due. Three capabilities silently stopped when Actions went
(the worker, the notebook reads, the backup) and each was found separately;
if something looks like it has not run since 2026-09-08, that is the first
thing to suspect.

**What Phase 10 has cost so far, which is the argument for doing it:** seven
real defects, none of which any existing suite could see. The router made one
attempt at one model. §31's exit criterion could not hold as written. A job
that crashed after committing produced a second output. No output had ever
been attributed to anybody. The event ledger had never recorded a real action.
§22's own sentence was classified as a request for work. And the Set up page
showed a green light for a backup that had stopped happening. Every one was
found by running the thing end to end, not by reading the code.

---

## What happened today, in one paragraph

Grant reinstalled Slack with `channels:join` and set the interactivity URL, so
the office is complete. Photorealistic avatars were generated, hosted and are
live. Team HQ was built and deployed. Then Google disabled the account four
vendors sign in with, which turned the day into an audit: NotebookLM is gone,
the Gemini key was already dead of the same cause, Groq turned out to be dead
too, and the backup rehearsal turned out to have failed every night since it was
written without telling anyone. All of that is fixed or recorded; none of it is
still bleeding.

---

## The rule the codebase is built on

From `src/jobs/worker.ts`: **it takes no shortcut that the database would have
allowed.** A worker knows what it is doing — it wrote the output, so why re-read
`reviewer_status`? Every such shortcut turns an enforced invariant into an
honour-system one, and the enforcement stays green because nothing exercises it.

And the defect this project keeps meeting, in eleven costumes so far: **a check
whose result does not depend on the thing under test.** When you write one, ask
what it would do if the feature were deleted. If it would still pass, it is not
a check — add a CONTROL that proves it discriminates.

Two siblings, each learned the hard way:

- a test that changes real configuration must restore it;
- **a failing check that notifies nobody is indistinguishable from a passing
  one.**

---

## What exists, by surface

**Slack — the office.** Results reach the thread that asked, presented as the
staff member who produced them, exactly once. Six §12 buttons, received and
acted on. The bot recovers itself from being removed from a channel.
`verify:slack`, 56 checks.

**Telegram — the pager.** One bot, registered to Grant. Pages at `important`
and above, silent below urgent. An interrupted send can never be reconciled — a
bot cannot read its own sent messages back — so it parks forever rather than
risk sending twice. `verify:telegram`, 28 checks.

**Team HQ — <https://ai-team-hq.vercel.app>.** Read-only, five views, four
sparklines, per-device layout memory. The token is in the vault as
`hq.api_token`; `npm run hq:token` sends it to Grant's phone. **Never print it**
— the deploy script did once, which is why it now cannot. `verify:hq`, 24 checks.

**Delivery is channel-agnostic.** `public.deliveries` and `app.claim_delivery`
serve both surfaces. Adding a third means adding a `Transport`, not a third
table.

**Voice notes.** Everything up to the API call. Without a credential every note
degrades to text and says `no_credential`, which is the acceptance criterion
working.

---

## Waiting on Grant

**Revised 2026-09-09.** Do not add to this list in chat. It lives here, in
[`known-problems.md`](known-problems.md) and on the Set up page, and the reason
is that surfacing needs one per turn is exactly what went wrong that week.

1. **Make the Telegram office group.** Telegram does not let a bot create one,
   so this step cannot be automated. New group → add all eight bots
   (`@agenticteamgrantbot` and the seven `@atg_*_bot`) → call it AI Team HQ.
   They register themselves on being added (`my_chat_member`, 0136), and the
   routing already exists: the Chief of Staff reaches Grant directly, everyone
   else moves into the room the moment it exists. It also appears on the Set up
   page as of 0142.
2. **Make a Notion Teamspace for each project, and share a database from it.**
   Answered on 2026-09-09 and now prompted rather than remembered. Notion's
   public API exposes no teamspace at all — no endpoint, no field, and a
   database inside one reports its parent as the workspace — so this genuinely
   cannot be automated and never will be until Notion adds it. Every project
   without a Notion attachment now reads `wanted` on the Projects page with the
   steps attached: make the teamspace, put a database in it, share that
   database with the Agentic integration, attach it to the project. After that
   the team can write into it unaided.

   `notion.project_slug` is gone (0161). It could only ever name one project,
   and it was named for something it did not hold — Grant: *"Configuration and
   database fields must use terminology that reflects what they actually
   reference."* The mapping is per project now, in `project_attachments`.
3. **Decide whether `vault-export` runs weekly.** It is the last duty still
   disabled. Enabling it means a copy of every credential arriving on Telegram
   every week — which is the only thing that would survive losing the Supabase
   project, and also a weekly credential broadcast. His call, and it needs
   `openssl` replaced with Web Crypto first so it can run in the worker.
4. **Add the MCP server to Claude,** if it is still wanted. The token is on
   your phone. Settings → Connectors → Add custom connector, paste the URL and
   the `Authorization: Bearer …` header.
5. **Rotate the Notion token when convenient.** It was pasted into a chat
   transcript on 2026-09-06, which is durable and searchable. Hygiene rather
   than an incident.
6. **A read-only GitHub token, if "look at my Rest Timer repo" should work.**
   `github.dispatch_token` is in the vault, authenticates as `granterogers`,
   and is scoped to THIS repository with contents:write — it was made for
   `repository_dispatch` (0126). It is what the read client uses, and it cannot
   see any other repository whatever it is allowed to do here. A fine-grained
   token with Contents/Metadata/Issues read-only across the repos he picks
   would close §8. Steps are in the 2026-09-09 audit.
7. **A CoachAccountable API key, if the team should update coaching records.**
   Researched rather than assumed: CoachAccountable has had a full REST API
   since 2015, with `Client.update`, `Action.add`, `Metric.addData`,
   `Session.add` and webhooks. Profile icon → Settings → System → API Access
   gives an API ID and a private key. That is strictly better than the
   login-and-scrape he asked for — no password stored, revocable, structured,
   and it does not break when they change their HTML.

**Notion is no longer a read-only integration.** As of 2026-09-09 the client
speaks API `2026-03-11` and can create pages, append and update blocks, set
properties and relations, upload and attach files (audio becomes an audio block,
not a download link), read a database schema before writing to it, and archive
reversibly. `notionCapabilities()` answers "do we have a token / what can I do /
is this read-only" without asking anybody. The full matrix, the three things
Notion genuinely cannot do, and the two breaking changes the version bump
brought are in [`notion-capability-matrix.md`](notion-capability-matrix.md).

**Settled, recorded so they are not re-asked:** Backblaze is safe (its own
password, no Google SSO); Google Cloud TTS is parked; the ownership of the
OpenRouter, OpenAI and Groq accounts is parked; voice is required (Grant,
2026-09-07) and is built; GitHub Actions is off for every process.

**No longer waiting:** all eight Telegram bots exist, are configured, answer,
and wear their own face. Notion pages are shared. The Google OAuth client
exists and all four services are connected.

---

## What arrived on 2026-09-07, and what it left open

The office can now act rather than only answer. In order of how likely you are
to trip over them:

- **Every notebook generation is gated on Grant's approval** (0083–0086). The
  gate is in `notebook.generate`, not in the office, because an MCP client and a
  scheduled retry can both start one. Approval creates a NEW job carrying
  `approved_by`; nothing resumes.
- **`jobs.not_before` and `jobs.announce`** (0074) exist and are load-bearing.
  A job can be delayed, and a job can decide its own output is not worth a
  message. Both are read by the worker and the notifier.
- **The notebook meter** (0078). Google's compute allowance cannot be queried —
  there is no API — so `notebook_spend` counts ours and a refusal lowers the
  ceiling permanently. Never present those numbers as Google's.
- **Voice notes** transcribe locally with faster-whisper. The audio never
  leaves the runner, deliberately; do not "improve" this by sending it to a
  provider.
- **`#the-floor`** narrates routing decisions in plain English, rendered clause
  by clause from the row. Do not let a model write it: an unconfident reading
  smoothed into a confident one is exactly what the channel exists to show.

Left open, and honestly: NotebookLM **slide decks fail** every time on this
account (four attempts, all `failed` from Google, with audio and mind maps
working). The boilerplate stripper removes 61% of a Wikipedia extraction but the
remainder still carries theme toggles and table-of-contents chrome — better, not
solved.

---

## §22 completion, measured rather than felt

**Revised 2026-09-09.** Both scenarios now have live harnesses, and the tables
below are what those harnesses report rather than a reading of the code. Run
them: `npm run verify:scenario-a` and `npm run verify:cross-interface`.

### A — source to conversation · `verify:scenario-a`, 20/20

| clause | |
|---|---|
| Grant adds a source from his phone | ✅ paste a link to any bot |
| detected within the sync interval | ✅ `discovery-sync`, hourly, since 0138 — reads run over HTTPS now, so the Edge worker can do them |
| Research analyses it | ✅ |
| justified specialists consulted | ✅ the cap, the justification and the refusal to convene are all enforced |
| Quality/Risk reviews | ✅ |
| findings written back | ✅ as a document; NOT into the notebook — ADR-0013 retired that |
| operational metadata in Postgres | ✅ |
| Slack project channel, correct staff identity | ✅ — and it was NOT, until 2026-09-09. 736 of 736 outputs had a null `staff_id`; a name was resolved for display and never persisted |
| Telegram notified where policy warrants | ✅ |
| react / respond / Undo | ✅ six buttons, all acted on; `undo_offers` idempotent |
| **Talk to Team — a live voice conversation** | ✅ Realtime over WebRTC, barge-in, live transcript, and an `ask_the_team` tool that reaches the office |
| Chief explains from real state, "bring Finance in" | ✅ — and §22's literal sentence was being delegated instead of answered until 0139 |
| work continues autonomously | ✅ |
| all actions versioned | ✅ — and the ledger had never recorded a single action by the working system until 2026-09-09. 75 events, all of them fixtures |
| usage in-app and in the daily capacity report | ✅ |

### B — cross-interface delegation · `verify:cross-interface`, 10/10

| clause | |
|---|---|
| the instruction through Slack | ✅ |
| identifies the project, creates a persistent initiative | ✅ — and asks first, after it created two projects nobody wanted |
| delegates to justified specialists | ✅ |
| routes conclusions through Quality/Risk | ✅ |
| works asynchronously, preserves state | ✅ |
| returns progress to the right Slack thread | ✅ |
| places rich artifacts in the notebook | 🟡 audio overviews and mind maps yes; slide decks fail every time |
| notifies Telegram only per policy | ✅ |
| **the same instruction through Voice** | ✅ asserted as an equality on the stored row, modulo the channel-native fields |
| generated code in an isolated workspace or branch | ❌ not built, and nothing generates code yet |

### What is actually left

Voice was the answer to the tension this section used to describe — Grant
settled it with three words, *"Voice is required"*, and it is built. What
remains is smaller and none of it is a scenario clause:

- **the code workspace** (§22 B's last line), which nothing needs yet because
  nothing generates code
- **slide decks**, which fail upstream at Google
- **`vault-export`**, the last duty still seeded disabled: it needs `openssl`
  replaced with Web Crypto to run in the worker, and switching it on means a
  copy of every credential arriving on Telegram weekly, which is Grant's call
- **a security review as a distinct pass** — `verify:security` covers RLS,
  vault isolation and role separation, but nobody has sat down and tried to
  break it on purpose

---

## What I would do next

**Finish Phase 10.** Provider failover, §31's cross-interface equality and
failure injection are done; `verify:chaos` covers seven of §18's twenty named
cases. The remaining thirteen are the obvious next block of work, and they need
nobody — §18 names them explicitly, so there is nothing to decide.

After that, **§22's scenario A end to end**: a source arriving, being analysed,
reviewed, delivered to the right Slack thread with the right face on it, and
reacted to. Every piece exists and is checked in isolation; nothing has run the
whole arc in one go.

**Phase 9 is unblocked but unscheduled.** ADR-0013 re-based it: Calendar, Gmail
and Drive were always going to read Grant's own data on his own account with his
consent, which is the supported path and carries no policy exposure. It needs an
OAuth client in a project he owns, and it needs someone to decide it is worth
the time before the hardening is finished.

**Do not revive the NotebookLM sync.** Not caution — ADR-0013 decided it. There
is no public API, so an unattended client must impersonate a browser session,
which is exactly what the ban named. Pasting a source in by hand still works and
produces a document like any other.
