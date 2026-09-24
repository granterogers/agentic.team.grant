# Team HQ (Basecamp) — UX/UI remediation ledger, 24 September 2026

Durable record of the Basecamp Team HQ UX workstream. **On compaction: reread
CLAUDE.md, then this file, then `git log --oneline origin/main..HEAD`, and
continue at NEXT ACTION.**

## Baseline

| | |
|---|---|
| Starting `main` | `d1c9247adc78c840c953c10450c81225a097e62c` (verified equal to expected) |
| Branch | `claude/dazzling-dirac-acjwqf` (the session's designated branch; branched from that `main`. The brief's preferred name `claude/team-hq-ux` was not used because this session may push only to its designated branch) |
| Surface | `/basecamp/...`, sources in `web/studio/bc/` |
| Out of scope | legacy studio, backend, migrations, fresh-install |
| Sandbox browser | `npm run trust:proxy-ca` needed an NSS db created first (`certutil -N`); now trusts the proxy CA with verification on |

## Capture tooling

`npm run basecamp:shots` — 104 screens × (viewport, full) at 1440 / 1024 / 768 / 390.

## Pass 1 — first look (overview, dark, desktop + phone)

| # | Surface | Finding | State |
|---|---|---|---|
| 1 | To-dos, Schedule | task titles CENTRED in their row, floating away from the checkbox / date chip | open |
| 2 | Card table, Docs, Contacts | content clipped mid-line at the card bottom with no fade | open |
| 3 | Docs & files | meta line (`PDF · 24,606 words`) sliced horizontally | open |
| 4 | Page header | the `…` page menu is a near-invisible 12px glyph on phone | open |
| 5 | Needs you | one small low-contrast pill; Late / Stuck not visible at a glance | open |
| 6 | Home frame | ~70px dead band above the toolbar, ~140px below the grid | open |
| 7 | Latest activity | timestamp column and timeline dot misaligned; empty dot for grouped rows | open |

## Changes

(appended as they land)

## Behavioural branch handoffs

(none yet)

## NEXT ACTION

Fix pass-1 findings, recapture, compare.
