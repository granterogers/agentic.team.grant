# 12-hour RC1 completion run — 18 September 2026

**Mandate:** RECONCILE -> FINISH IMPLEMENTATION -> REAL EXERCISE -> CLOSE
SATISFIED ISSUES -> RC1 QUALIFICATION -> PREMIUM VISUAL POLISH -> FINAL
HANDOVER. Full prompt is the uploaded brief; the operative sections are
reproduced below so this survives a compaction.

## After a compaction

READ CLAUDE.md -> docs/RUN-LEDGER.md -> this file -> git log -> live issues ->
CONTINUE. Do not ask Grant to paste the prompt again.

## Starting state (verified, not assumed)

| | |
|---|---|
| starting HEAD | `e269057` |
| origin/main | `e269057` |
| branch | `claude/phase-7-communications-kh8ow8` |
| tree | clean |
| migrations | 494 |
| tests | 1,753 |

## Priorities, in the brief's order

1. **Browser/computer programme** — #16 + #135 + #261 as ONE capability.
   Preserve PUBLIC FETCH vs INTERACTIVE AUTHORIZED SESSION. Maintain SSRF
   protection incl. link-local/cloud metadata. Never weaken security to make a
   browser test pass. #135 needs the Browser tab to be a real surface: what,
   where, for which project, what it did, resulting files, and how to STOP it.
2. **#258 artifact generation** — full vertical slice to a rendered, visually
   inspected, delivered PDF. A DB row is not an artifact.
3. **#259 unified Personal Tasks** — Personal Tasks != Agent Jobs.
4. **#260 NotebookLM generated artifacts** — inspect real provider
   capabilities; do not design from assumptions.
5. **#172 Gmail project intelligence** — epistemic honesty preserved.
6. **#41** is the release-verification spine: CHECK + CONTROL + REAL EXECUTION.
7. **RC1 qualification** (clean start, core journeys, failure/recovery,
   provenance, security, performance) then **premium visual pass**.
8. **Final handover, pushed**, separating TESTED / INFERRED / NOT TESTED, and
   an honest RC1 READY / NOT READY decision.

#18 and #213 are Grant's own credential rotations. Documented, skipped, not to
be rediscovered.

## Standing constraints

- Do not commit or push a known-red tree. READ EXIT CODES.
- Do not weaken a gate to merge. Wire unreachable capability rather than
  deleting it.
- Never expose a secret value anywhere.
- Team Evolution must not derail release completion.

## Log

- **reconcile** — HEAD `e269057`, clean, == origin/main. Ledger's next action
  was the browser cluster; the brief makes that Priority 1 too.

- **browser cluster, batch 1** (`198b984`) — SSRF: the private-address guard
  ran once and `fetch` chased every redirect. Fixed with manual redirects, a
  shared `whyRefused` per hop, a 5-hop cap, and a jar that only goes to its
  own host. 4 regressions + 3 sabotages.
- **batch 2** (`9c65e6b`) — `browser_lately` has returned `shot_path` since the
  ledger existed and nothing rendered it; #16's "a recent screenshot" was
  unmet only on screen. Gateway signs it; the tab draws it. `check:tokens`
  added to the gate after `var(--shadow-1)` (no such token) passed every
  existing check — found 6 more live undefined tokens.
- **batch 3** (`b264337`) — `web.telegram.org` returned ok:true with TWELVE
  characters of text: a small shell walked past `looksLikeAShell`, which
  wanted little text AND heavy markup. `BARELY_ANYTHING = 80` absolute floor,
  chosen from four measured pages. `verify:browse-live` 30/30 against the real
  internet, including the handler chain.
- **batch 4** (`aa9bf7f`) — 0495 `app.browser_now`: the tab had no present
  tense and no Stop on it. `npm run shot:browser` renders four states; it
  found the capture photographing the wrong screen, a thumbnail wrapping into
  the verb column, and a CSS fix that was dead on arrival behind
  `.bsites .brow`.
- **batch 5** (`9271ba3`) — `browser_session_establish` was unpressed behind a
  baselined reason that was FALSE ("blocked behind Cloudflare"). Nothing about
  pasting a session Grant exported needs Cloudflare. Form built; baseline
  14 -> 13. Its first check was inert (submit re-renders the form) and a
  sabotage proved it; rebuilt against submit-wiring and cancel-clearing.

Deployed: hq-api v596, studio live.

### Position

#16 and #135 acceptance is met except for one thing that is Grant's: no
gather has been performed BEHIND A REAL LOGIN, because that needs a session
he establishes himself on a real site. Everything under it is proved — the
jar reaches the Vault, the runtime sends it, an expired jar reads as
signedOut rather than as an outage.

Next: #261, then #258.
