# Final audit of the Team HQ UX candidate, 5 October 2026

Read against the ORIGINAL brief (`docs/spec/team-hq-ux-brief-2026-10-04.md`, stored verbatim by this audit) and not against
the ledger. Nothing here contacted production, a real Google, Drive, Vikunja, ChatGPT or Claude. Every browser run had its
network resolver disabled for anything but 127.0.0.1.

## What was audited, how

Five independent read-only audits (workspace and Post-its; Calendar and Google; Documents; search, palette, Activity, MCP and
Vikunja; research, autonomy, PDF and style), each finding the implementation, confirming it is wired into the shipped page /
gateway / worker, finding its tests, RUNNING them, and attacking it. Their findings were then verified and fixed here, each fix
with a regression that was seen to fail on the unfixed code. p4's three newer commits (`39e2f247`..`4fafdf38`, the sign-in
path) were merged in: they touch six of the same files and one was a semantic conflict (`office.readFile` made a bare
`fetch`, which p4's own test forbids), fixed.

## Defects found and fixed (all with regressions)

| # | Defect | Fix | Evidence |
|---|---|---|---|
| 1 | Post-its lost to last-writer-wins on the one stored workspace document: two tabs, two devices, an offline note, a closed tab inside the save delay, Reset View in a stale tab | merge note by note, removal records, flush on hide, maxlength | `tests/studio/postit-merge.test.ts`, `workspace.ts` two real tabs |
| 2 | Close / Esc pushed a history entry, so Back after Close reopened the module | Close is Back; deep link replaces | `workspace.ts` 14b, sabotage-proven |
| 3 | Post-it could not be moved from the keyboard; removal was instant and final | Alt+arrows, Undo | `workspace.ts` 14c |
| 4 | 412: an unreadable Google `updated` re-sent the local copy with NO note; a tie went local; a description edit the pull cannot see was reverted silently | order must be KNOWN to overwrite; content must match to be "merely stale" | `calendar-events-etag.test.ts` (17) |
| 5 | SSRF guard let IPv6-wrapped IPv4 (incl. `::ffff:169.254.169.254`), a trailing dot, CGNAT and other ranges through, refused `fdic.gov`, never resolved names, read unbounded bodies | rewritten, `dns.ts`, 2 MB cap | `tests/browser/private-hosts.test.ts` |
| 6 | Only the MCP door obeyed the autonomy dial | web research, document creation, style saving ask `mayAct` | `the-dial-stops-the-office-writing.test.ts` |
| 7 | A long URL in a source discarded the whole report; EUR printed `?` | handled break; WinAnsi map | `qa.test.ts`, `pdf.test.ts` |
| 8 | A source document could be moved out from under the disconnected-source gate; a revoked login still made a managed copy; MCP read returned a switched-off source; a watch ingest queued before a folder was switched off still fetched | migration 1021, `drive-read.ts` | `07-audit-1021.sql`, `import-source-gate.ts`, `drive-read-gate.test.ts` |
| 9 | A draft could supersede (hide) an approved document | migration 1021 | `07-audit-1021.sql` |
| 10 | MCP: a refused update left a half-applied change; an assistant could reopen a cancelled task; `kinds=` found nothing below the limit; the database did not check the write scope; `start_research` never started a web lookup; unreadable dates were silently dropped | migration 1021, `tools.ts` | `07-audit-1021.sql`, `audit-1021.test.ts`, `tools.test.ts` |
| 11 | `document_provenance` could point at another office's document (single-column FK); two UX tables had no office-led index; **the structural tenant check could not run on the replica at all** (wrong guard import) and its bridge control was order-dependent | migration 1022, `check-office-edges.ts` | `check:office-edges --replica`: every edge enforced, every control fired |
| 12 | `calendar-event-sync` shipped switched ON | migration 1021 | schema fingerprint |
| 13 | Style tone, audience, terminology, sections and instructions were stored and never read | `styleVoice` | `style.test.ts` |
| 14 | Staging-shell `migrate` could overwrite production's ledger | `.staging/applied.json` | `staging-ledger.test.ts` |
| 15 | Smaller: Schedule copy, Google card wording, Cmd+K on a Mac, palette placeholder, fall-back hour length, secret-scan markers on synthetic specimens | | see the ledger |

## Answers to the merge questions

- **A. Any known implementation requirement unfinished?** No. Ledger Group A is empty. Known limits are listed in the ledger.
- **B. Any known safety defect unresolved?** None known that is not a stated limit: DNS is checked before each hop but `fetch`
  re-resolves when it connects (true rebinding is not closed from inside the runtime); a Google token revoked at Google's end
  leaves the connection `active` until a call fails (the import then fails with a provider error, not the typed code, and
  fetches nothing).
- **C. Tenant isolation locally proven?** Yes, locally: 96 ownership checks, 1,421 application attack checks, the structural
  edge check with all eleven controls, SQL attacks as office B against office A's ids for search, MCP, documents, jobs, tasks
  and events (rolled back), and an edge probe with forged `p_office` / `p_client_id`. Not proven through a deployed gateway.
- **D. Migrations coherent?** 789 files; the whole history replays into an empty database; its catalogue fingerprint equals
  the psql-built replica line for line; the 761 recorded checksums equal `migrations/applied.json`; 28 are unapplied in
  production (`0892`..`1022`).
- **E. Production guard intact?** Yes. Sabotaged three ways (checks gate, writes gate, fetch guard): 9, 3 and 3 tests went red;
  restored, 41/41. No path sets `ALLOW_PRODUCTION_*`; the workflows that do are `workflow_dispatch` only.
- **F. Background duties safe by default?** `drive-index` and `calendar-event-sync` are off.
- **G. Compiles for its deployment?** `tsc` clean; `deno check` clean for `hq-api`, `mcp`, `signin`; the worker's six errors are
  in five files this work never touched (see below).
- **H. Remaining PARTIAL rows predominantly real-service verification?** Yes: 39 of 40 are Group B; two are Group C; two are Group D.
- **I. External uncertainties documented?** Ledger, this file, `docs/staging-handoff-plan.md`.
- **J. Would merging this code damage the live system?** Merging changes no database and deploys nothing. See "Deployment".

## The six worker `deno check` errors

All six exist unchanged on p4 and in files this work did not touch. Four are `Record<string, unknown>` to a named type casts
(`channels/progress.ts`, `handlers/browser-gather.ts`, `handlers/source.ts`) and a `Uint8Array` to `BlobPart` typing under newer
TypeScript (`voice/inbound.ts`); two are in `supabase/functions/worker/index.ts` (`Deno.serve` is absent from a hand-declared
`Deno` shim, and a `SqlExecutor` is passed where `ManagementApiExecutor` is typed). They are type-level only: the Supabase
bundler does not type-check and these exact files are what is deployed and running. They cannot prevent bundling or deployment.

## Browser QA

Real Chromium, served as Vercel serves it: `workspace.ts` 73/73 (move, resize, overlap, guides, Tidy, Reset View, zoom incl.
Ctrl+wheel, tints, saved layouts, maximise, Back/Forward/Close/Esc/reload/deep link, Post-its, two tabs, keyboard);
`ux-matrix.ts` 34/34 at 1440, 1280, 1024, 900, 768 and 390 plus reduced motion; `calendar-ui.ts` 25/25; `docs-ui.ts` 58/58;
`docs-preview-ui.ts` 69/69; `palette.ts` 28/28; `activity-ui.ts` 9/9; `google-card.ts` 19/19; `ux-a11y.ts` axe clean; `ux-motion.ts`
34/34. Captures were opened and read at 1440, 900, 768, 1024 and 390. VIS-001 and VIS-003 are Grant's.

## Deployment (what merging does and does not do)

Nothing in this repository deploys on a push: the GitHub workflows are `workflow_dispatch` / `repository_dispatch` only, the
docs say deploys are `npm run deploy:*` and tell the operator NOT to connect Vercel's Git integration, and GitHub shows no
Vercel status or check on any commit of `main`, `claude/multi-user-p4` or this branch (a connected project posts one on every push).
That last point cannot be proven from here and is the one thing to confirm in the Vercel dashboard.

Merging into `main` carries p4's multi-user stream (already live in production, from p4) AND the UX work. The 28 unapplied
migrations are NOT applied by a merge. When Grant deploys: apply `0892`..`1022` in order; deploy the worker first, then `hq-api`,
`mcp`, then the web page; then, one at a time and only when wanted, enable `calendar-event-sync` and (last) `drive-index`.

## To verify after deployment (the Group B list)

Real Google consent and scopes; a real Calendar create / edit / delete, an All-day event, a time zone, a deliberate 412; a real Drive
Doc / Sheet / Slide / PDF / image read, preview, thumbnail and Import; revoke Google and confirm Import is refused with
`SOURCE_DISCONNECTED` and nothing was fetched; a second signed-in office through the deployed gateway (deep links, stale tabs,
search, preview, MCP); ChatGPT and Claude through the deployed `mcp` function (positive and negative); the "via ChatGPT / Claude /
Telegram / Slack" chip on a real event; a deployed web lookup; a PDF with a real logo from real storage; Vikunja create / edit /
delete / outage / recovery. Do these against production only with Grant's say-so; none is needed to decide the merge.
