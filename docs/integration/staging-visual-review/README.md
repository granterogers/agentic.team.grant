# Staging visual review package, 10 October 2026

Candidate: `integration/aesthetic-release-candidate`. The web page in these captures is the code deployed as `dpl_9FYYe3kssKGCCDtWggCjPeD1vvXu` (commit
`97524b44`; every later commit changes scripts and docs only). Colours are reduced to 96 so the folder stays small; regenerate full-resolution captures with the
commands below. Nothing here contains a secret, personal data or a production record: every office is synthetic.

**What each folder is** (read the source before trusting a picture):

| Folder | Page | Office behind it | Notes |
|---|---|---|---|
| `hosted-preview-lab/` | the **deployed preview** (https://team-hq-ux-review.vercel.app), real host | the lab's stand-in office (one empty project) or the signed-out prototype | `matrix-*.md` are the lab's own verdicts (verified / defect / blocked) per cell |
| `hosted-preview-populated/` | the **deployed preview** | the **real `hq-api` code answering from the isolated replica**, with realistic synthetic data | `generated-*` files use a **generated** 90-message conversation (the office cannot seed one); everything else is `real-*` replica data |
| `local-replica-extra/` | the working tree served locally | replica (populated) or the stand-in | other looks (Forest & Brass, Warm Graphite, Rich glass), landscape phone 844x390, tablet 768 |
| `before-after/` | before: `0df5ec9` served locally; after: the deployed final code | the same replica data | side by side, labelled |

File names: `<surface>__<device>-<scheme>-slate.png` (lab) and `<real|generated>-<viewport>-<scheme>-<surface>.png` (populated).

## Index

- Hosted, desktop 1440 and phones 390, 360, 430, dark and light: home, project board, burger menu, page menu, Jump, background picker, chat dock, maximised
  To-dos / Schedule / Card table, event editor, danger confirmation, sign-in, set-up-office, My Tasks, Search, Project Settings, Settings (Appearance, Behaviour, Team),
  undo strip, empty project.
- Hosted + populated: busy project board (140 to-dos, 36 documents, 28 contacts, 12 events), each maximised module, My Tasks with 70 items and repeating reminders,
  the project menu with six projects (one 100-character name), the long-name board, the chat dock with 90 generated messages, an emulated soft keyboard, Settings, Search.
- Other looks populated: Forest & Brass and Warm Graphite with Rich glass.
- Before / after: project menu long name; maximised month calendar; Card table cards on a phone; My Tasks tick.

## Inspection matrix (what was opened and judged)

| Surface | Hosted lab | Hosted populated | Read by eye | Notes |
|---|---|---|---|---|
| Home, project board, menus, Jump, background picker | yes | yes | yes (samples) | axe clean at all widths |
| Settings (all tabs), Appearance | yes | yes | yes (Appearance, dark) | tabs below the fold in landscape were pressed manually |
| Chat dock, long conversation, emulated keyboard | yes | yes (generated thread) | yes | iOS keyboard not testable |
| Maximised modules, compact schedule Day/Week/Month | yes | yes | yes (schedule, documents, tasks) | month chips corrected |
| My Tasks, repeating reminders, Stop repeating | yes (prototype) | yes | yes | main's new surface, now styled in the palette |
| Records (task, contact, document), event editor | prototype run 22/22 | n/a | yes (several) | stand-in has no records |
| Auth: sign-in, create account, signed-out, set-up | yes | n/a | yes (sign-in) | one unexplained 430px measurement, not reproduced |
| Voice controls | buttons only | n/a | in the dock captures | simulated audio only; no real microphone |
| iOS Safari | **not tested** | | | no WebKit or device here |

## Commands that regenerate these (local, no production)

```
# hosted lab (any width / scheme; one run per call)
BASE=https://team-hq-ux-review.vercel.app SLOW=2 WRITER=1 AXE=1 DEVICES=phone390 SCHEMES=dark OUT=.out/hosted npx tsx scripts/verify/surface-lab.ts
# populated, on the replica (bash scripts/isolated/replica.sh once; createdb bq template post)
npx tsx scripts/isolated/stress-browser.ts bq --only=1440,390 --base=https://team-hq-ux-review.vercel.app --shots=.out/stress-hosted
# before: serve the old tree's page
STUDIO_ROOT=/path/to/old/web/studio npx tsx scripts/isolated/stress-browser.ts bq --only=390 --shots=.out/stress-before
```

Results and defects: `docs/integration/aesthetic-staging-validation.md`.
