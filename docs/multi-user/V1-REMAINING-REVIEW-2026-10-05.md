# Multi-user V1: remaining-work review and #407 closure (5 October 2026)

V1 as defined here: **one authenticated human account, one private office, many projects.** No organisations, memberships,
invitations, shared offices, tenant switching or enterprise RBAC. D5 of the tracker (#402) already decided that Telegram and
Slack linking is operator-provisioned in V1.

## 1. #407, exactly

* **Symptom (2 Oct 14:18 to 3 Oct 06:19):** `google.read_mail` and `google.read_calendar` failed `no_office`.
* **Cause:** both handlers called `refreshMail`/`refreshCalendar` with no office, which fell back to `soleOffice(db)`. Once a
  second real office existed, `app.sole_person_office()` was NULL and `trustedOffice` correctly refused ("never a guess").
* **Fix (af2a7b8d, worker v931, deployed 3 Oct 07:20):** the handlers take the office from the claimed job
  (`officeOfJob`). Since then every duty has completed (checked 5 Oct: `drive.watch` 11, `google.read_calendar` 2,
  `google.read_mail` 2 in the last two hours, all complete, all in Grant's office).
* **The deeper question (whose Google credential does an office get?)** was already answered by 0800 and is now proved
  directly. The office passed to `refreshMail`/`refreshCalendar` is only a label for health and cached rows; the TOKEN is read
  through `app.deployment_credential(office, 'google.refresh_token', ..., job)`, which
  1. maps the office to a vault name with `app.google_vault_name` (Grant's office, named explicitly by `deployment_operators`,
     gets the bare name; every other office gets `google.refresh_token.<office_id>`, which is empty today);
  2. refuses unless the job is internal work or an operator's trusted turn AND the job belongs to that office;
  3. refuses a null or nonexistent office, and a job claimed by another office.
* **Production, read-only, 5 Oct:** Grant `2a2cd4d4` resolves the bare name and a secret exists; Sample `205669cc` resolves its own
  name and holds none; System `1d22ef97` resolves its own name and holds none. No non-Grant office holds Google duties.
* **Proof:** `scripts/isolated/google-office-binding.ts` on the isolated replica, 19/19. It includes the positive control
  (Grant's own duty is served), forged job/office pairs, a missing job, a missing office, a second office with its own stored
  token (never served Grant's) and a negative control for the old sole-person behaviour (with the operator removed and two
  people present the home office is NOT guessed). Sabotage: making `google_vault_name` return the bare name for every office
  turned four checks red (15/19), and the replica rebuild turned it green again. The deployment_credential refusal held under
  that sabotage, which is the second line of defence doing its job.
* **No code change was needed for #407.** No deploy was made in this run.

## 2. Sibling search (sole person, first person, Grant fallback)

| Where | What it does | Reachable in V1 production? | Class |
|---|---|---|---|
| `src/google/mail.ts:110`, `calendar.ts:83` | `officeId ?? soleOffice(db)` | No: both handlers always pass the job's office; with two offices the fallback returns no office and the call fails closed | 2 (remove the dead fallback) |
| `app.google_home_office()` | `coalesce(operator_office(), sole_person_office())` | Operator exists, so explicit. Without an operator and with two people it is NULL (proved) | 2 (drop the sole-person branch) |
| `app.sole_person_office()` in live SQL | only the function above uses it | n/a | clean |
| `src/` other `soleOffice` callers | none | n/a | clean |
| machine-key reaches of an ambient person | `check:machine-key`: 40 actions, 0 reach an ambient person | n/a | clean |
| `scripts/` operator tools | `check-office-callers.ts`, `p4/sabotage.ts` | operator tooling only | 3 |

Nothing found is reachable AND capable of leakage, wrong-person execution or broken operation, so nothing was fixed in code.

## 3. Held deployment queue (not executed)

| Item | What / why | V1 needs it? | Production already equivalent? | Risk now | Recommendation |
|---|---|---|---|---|---|
| 0892 slack_install_client | reads Slack client id and scopes for the Settings card | No (Slack linking is operator-provisioned in V1, D5) | n/a | low | HOLD FOR LATER (with Slack) |
| 0893 own workspace counts as installation | makes a person's Slack workspace accepted by `slack-events` | No, same | n/a | low | HOLD FOR LATER; must ship WITH the worker/hq-api Slack change |
| 0894 whitespace passage not content | retrieval correctness | No | none affected | low | HOLD FOR LATER |
| 0895 revoke 37 legacy `ai_team_app` grants | removes doors on a role nothing connects as | No (the role is unused) | the role is NOLOGIN and passwordless | low | DEPLOY SOON (hygiene, independent) |
| 0896 disconnected source leaves retrieval (ADR-0066) | Grant's 4 Oct policy; changes what answers may use | No | the old behaviour keeps the corpus in play | medium (behaviour change) | HOLD FOR LATER until Grant wants the policy live; must precede its page and worker text |
| `hq-api` | Slack link sections and actions | No | n/a | low | HOLD FOR LATER with 0892/0893 |
| `slack-oauth` | new function, needs `slack.client_id` | No | never deployed | none until configured | HOLD FOR LATER |
| `worker` | install-aware Slack channel, envelope ceiling, Drive text path | No | the live worker is v931+ | medium (deploy sets `slack.per_office_delivery`) | HOLD FOR LATER |
| Page delta (confirm dialogs, phone header icons, Slack card, noticeDialog) | polish and Slack card | No. The Slack card needs 0892/0893 and the hq-api change; `hq-page-delta.ts` ships the whole working tree, so do not ship it alone | the live page is the sign-in fix on live bytes | UI would depend on unapplied schema | HOLD FOR LATER; ship page and backend together |

The only dependency trap: the page's Slack card must never go out before 0892/0893 and the hq-api change.

## 4. The six old queued jobs

All six are `research`, `queued`, `is_fixture`, requested by `verify:proposes`, in the TEST office, created 4 Oct 15:11 to 15:18.
Real queued or retrying jobs: 0. The supported mechanism is `npm run purge:fixtures -- --go`; its dry run reports it would
also sweep 19 fixture tasks in the SAMPLE office (added by `verify:p4-second-person`). That touches the Sample's data, so
it was **not run**. They are inert (no real effect, none claimable by a real office).

## 5. Remaining-requirements checklist

1 MUST FIX BEFORE V1: **none.**

2 SHOULD FIX SOON AFTER
* Remove the sole-person fallbacks in `refreshMail`/`refreshCalendar` and `google_home_office()` (above).
* Apply 0895 (hygiene); decide when 0896 goes live.
* #403 (about 70 suites insert into carrier tables with no office) and #420 (isolated-proof fixtures predate the office model;
  `p1-credentials.ts` groups 2 to 4 now fail on `inbound_commands.project_id` NOT NULL). Both are test debt, fail closed.
* #422 page fan-out (deliberately not optimised).
* Per-office Google connection for a second human (self-service). Today the second person has no Google; that is the safe state.

3 OPTIONAL / LATER: #410 (self-service Telegram and Slack, Slack held), #392 and #397 residual authority questions, #385 and #390
(`p_by` defaults pinned by `check:machine-key`), #399 row policies, #412, #416 to #419.

4 ALREADY COMPLETE: sign-in reliability (#421; deployed 5 Oct, 19/19 acceptance, 21/21 harness vs 6/21 before, sessions survive an
Auth outage), sign out (#405), identity/name (#404 as verified by the second-person production proof, 28/28), #407, office
ownership and composite keys (P2), function conversion (P3), second-person isolation proof (P4), #400 and #401 guards,
Google credential per office (0800, proved above).

5 OBSOLETE: the research-era phase list in #402 (P0 to P6) no longer matches how the work was done; `ARCHITECTURE.md` section 12
"per-office credential rows deferred" is now only the self-service half.

## 6. Verdict

**MULTI-USER V1: COMPLETE**, on the definition above. Three honest limits: Slack self-service is built but not deployed and not
required by D5; real Telegram pairing tap, voice note and Talk to Team remain MANUAL acceptance for Grant; and this review read
the P4 acceptance record for the second-person production evidence rather than re-running it.
