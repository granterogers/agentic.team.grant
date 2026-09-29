# Reader × representation matrix (Architecture Run 1)

| Reader | Before | After |
|---|---|---|
| `cleanDictation`, pairing | raw | raw (unchanged) |
| `rejectsWithoutSaying`, `closesWithoutAsking` | cleaned | cleaned, ordered by `decideEarlyGate` |
| `readRetraction` | cleaned | cleaned (result is `Turn.withdrawn`) |
| thread resolver | kept | kept (result is `Turn.resolved`, a Paraphrase) |
| `speaker`, `classifyIntent`, `route` | resolved | resolved (routing only) |
| `readPlan`, `populateRequest`, `connectRequest`, `linkRequest`, `pageRequest` | resolved (leak) | `turn.kept` via `entitled.*` |
| `callsItOff`, `readCorrection`, task readers | cleaned incl. withdrawn half | `turn.kept`; call-off skipped on a whole-message answer |
| `readTeaching`, `wantsAnotherGo` | kept | `turn.kept` via `entitled.*` |
| `spokenAnswer` | cleaned | `turn.answer` (peeled) else `turn.kept` |
| `understand` | resolved | `turn.kept` |

Baseline behaviour found with the model degraded to `{}`:
"Yes — and remind me tomorrow." resolved the blocker and dropped the reminder;
"Yes, do that. Also from now on…" stored "Yes, do that." as a standing
preference and left the blocker open; hostile resolver rewrites started plans,
saved links and opened pages (turn-entitlement 9/12). All fixed; proofs in
`scripts/isolated/{turn-entitlement,mixed-turns,open-question}.ts`.
