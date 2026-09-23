# Basecamp Team HQ — product acceptance, 23 September 2026

Written to be conservative. Where a capability has not been proved at a level,
it is not claimed at that level, and the sentence says what is missing rather
than what is close.

| | |
|---|---|
| **Live URL** | https://agentic-team-hq-basecamp-agentic-team-grant.vercel.app |
| **Opens at** | `/` redirects (307) to `/basecamp/p/legacy-coaching-course` |
| **Final HEAD** | `f6f4cae` on `claude/basecamp-team-hq`, pushed |
| **Deployed** | 78 files; every one byte-identical to the working tree by sha256 |
| **Not merged** | nothing on `main`, no pull request, the default Team HQ untouched |

## What "DEPLOYED VERIFIED" means here, exactly

It does not mean a browser in this container drove the public URL. It cannot:
**Chromium here cannot verify any public certificate at all** — `example.com`
fails the same way, with and without the proxy — so this is the container's root
store, not the deployment. `curl` verifies the genuine Vercel chain from the same
container, which is how that was established rather than assumed.

So the deployed product is tested like this, and the distinction is kept in
every suite's own output:

1. `npm run live:mirror` **fetches all 78 files back from the host over the
   network** and compares each one's sha256 with what was uploaded. Today: *77
   identical*, plus `index.html`. It also checks the host's 307 root redirect
   and the SPA rewrite on a deep link, over the network.
2. Those returned bytes are served locally and **every suite runs against
   them**, announcing `subject: the deployed bytes in .out/live`.
3. When the mirror is absent a suite falls back to the working tree and **says
   so**, because a gate that silently changes subject is worse than one that
   refuses.

That is stronger than testing the working tree and weaker than driving the
public origin. What remains unverified by it: anything that could differ between
the host serving those bytes and a local server serving the same bytes —
response headers, CDN behaviour, and the real TLS handshake in a browser.

## Where each capability stands

**Read the levels cumulatively**: INTERACTION includes VISUAL, PERSISTENCE
includes INTERACTION, and DEPLOYED means the evidence above was gathered against
the deployed bytes.

| Capability | Level reached | What is NOT claimed |
|---|---|---|
| Configurable project home — drag, resize, collision, compaction, hide, restore, reset | PERSISTENCE + DEPLOYED | — |
| Layout persistence across reload and across leaving the project | PERSISTENCE + DEPLOYED | it is this browser's `localStorage`; Issue #299 blocks office storage, so it does not follow Grant to another device |
| Internal scrolling with styled scrollbars, no "N more" | INTERACTION + DEPLOYED | — |
| To-dos: tick, open, add, edit, assign, date, complete drawer | PERSISTENCE + DEPLOYED | rows with an office record write to the office; the prototype's rows are remembered in this browser and the record says so |
| Card Table: drag between columns, colour coding, thumb control | PERSISTENCE + DEPLOYED | — |
| Schedule: entries open the to-do they name | INTERACTION + DEPLOYED | — |
| Docs & Files: thumbnails, real page renders, glyph fallbacks, audio playback, new-tab opening | INTERACTION + DEPLOYED | **external import from Google Drive or another connector is NOT built** |
| Chat with Team: toggle, history, avatars, honest failure | INTERACTION + DEPLOYED | a real conversation needs the office; the failure path is proved, the answer path is not |
| Sources: service marks, records, add | INTERACTION + DEPLOYED | connecting a real service writes through the office and was exercised only against a refusal |
| Contacts: every field, image upload and removal, notes, validation | PERSISTENCE + DEPLOYED, **prototype only** | **NOT REAL BACKEND VERIFIED.** `public.contacts` has no update path in production. The writer is written and NOT applied — `docs/basecamp/CONTACTS-BACKEND-HANDOFF.md` |
| Needs You / Late / Stuck as real filters whose counts match the records | INTERACTION + DEPLOYED | — |
| Back closes a modal, then a view, then the project | INTERACTION + DEPLOYED | driven with the browser's own history traversal, plus Forward and reload |
| Project Settings and Global Settings in the new design system | INTERACTION + DEPLOYED | — |
| Project identity: colour, icon, image | INTERACTION + DEPLOYED | — |
| Failure paths: writes, reads, storage, media, documents | INTERACTION + DEPLOYED | — |
| "This is not your office" notice, in all four states | INTERACTION + DEPLOYED | — |
| Phone at 390×844, and `prefers-reduced-motion` | INTERACTION + DEPLOYED | measured in an emulated touch context, not on a physical handset |
| Microphone: states, permission, endpoint, SDP attempt, failure, cancel | INTERACTION + DEPLOYED | **REAL HUMAN-MEDIA VERIFICATION STILL REQUIRED** — see below |

## Voice: exactly what is and is not proved

Proved, against the deployed bytes: the control is on the head beside Chat with
Team, both are 44px and visually distinct; it says nothing before it is pressed;
pressing it shows *connecting* rather than nothing; **the browser is really asked
for the microphone**; the office voice endpoint is really called; **an SDP
exchange with the realtime service is really attempted**; a session that cannot
be established says so beside the control; the control returns to idle rather
than claiming a call; cancelling leaves no microphone running; and a denied
permission is reported rather than swallowed.

Not proved, and not claimed: **a conversation**. That needs the deployed voice
token function, a live key, and a peer connection to `api.openai.com` — none of
which exists in this container, where the office endpoint and the realtime
service are both stubbed. Nobody has spoken to the team through this build and
heard it answer. That is the single largest gap in this report.

## Everything else still outstanding

1. **Contacts against the real office.** Handed over, not applied. Production was
   at migration 0565 while this branch carries 533, so applying from here would
   collide with an applied migration or leave a 32-file gap.
2. **Document import from an external source.** Not built. The gallery reads and
   opens; nothing brings a file in from Drive or a connector.
3. **A real conversation, and a real voice call.** Above.
4. **Office-side layout storage** (#299), so an arrangement follows Grant.
5. **Module sizes.** `shell.js` is 2,555 lines and `wire.js` 1,776. The right
   split is by surface; it is not done, because a refactor of that size in the
   last hours of an acceptance run is the destabilisation the standing rule
   forbids. Named rather than done.
6. **A physical phone.** Everything at 390×844 is an emulated touch context.

## The gates behind all of this

Run against the deployed bytes unless stated.

| Gate | Result |
|---|---|
| `basecamp:gate` — journey, preservation, routes, controls, coverage, measure | green; 315 controls pressed, 0 findings, no absolute violations |
| `basecamp:gate2` — 13 suites | board 30, to-dos 24, cards 18, docs 16, back 15, contacts 23, voice 16, settings 21, words 20, affordance 16, torture 24, failures 39, touch 26 |
| `npm test` | 2,223 unit tests |
| `npm run lint`, `typecheck`, `check:secrets`, `check:templates`, `check:migrations` | clean |
| `verify:ui`, `verify:layouts`, `verify:wired`, `verify:hq` (the default Team HQ) | 54/54 · 64 states, 0 findings · 77 attributes, no dead controls · green |

**Every detector added in this pass was proved able to fail**, by a sabotage
whose own effect was printed before the result was read: capping every pane,
blinding the collision predicate, swallowing the office's words, removing the
not-live strip, animating a title for ever against the preference, and returning
a count chip to a `<span>`. One check was found that could **not** fail — an
empty-office assertion that a skeleton satisfied — and it was rewritten as a
positive property rather than left green.

## What this pass tried to prove wrong, and did

The instruction was not to confirm the previous run. Five things it broke:

1. **Invented contacts presented as real records** when the office could not be
   read, with nothing saying so. Fixed in the frame, once.
2. **The conversation composer at 15px**, which makes iOS Safari zoom the whole
   page on the field somebody uses most on a phone — in the shared studio, not
   the experiment.
3. **The migration's number**, which collided with one the main workstream
   applied on 21 September and would have failed for whoever merged.
4. **Four count chips in the then-deployed bytes** that looked like filters and
   were not — found by the new gate on its first run.
5. **Its own instruments, repeatedly.** Fourteen findings this pass were the
   harness rather than the product: a vocabulary lock that read five honest
   refusals as silence, a refusal shaped `{data:{error}}` where `act()` reads
   `{result:{error}}`, reads passed through to an office this container cannot
   reach, three selectors resolving to a hidden twin of the control they named,
   a raw click that does not scroll, and a module grown when it was already at
   its maximum. Validate the test before believing the finding remains the
   most-used rule in this repository.
