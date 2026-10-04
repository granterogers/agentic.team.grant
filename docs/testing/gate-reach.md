# What the release gates reach (#414), 4 October 2026

Two gates exist, and they answer different questions.

| | `npm run gate:safe` | `npm run gate` |
|---|---|---|
| Question | Is the build sound, and did running the checks leave every real office untouched? | Does the whole office still behave end to end? |
| Touches Grant's office | **No.** Asserted: Grant and every other office are fingerprinted before and after and the gate fails if either moved | **Yes, for some suites** (below) |
| Spends model calls | **No** | Yes, for some suites (below) |
| Runs when | Any time, serialised, in the foreground; one health reading first, and it stops rather than add load to a slow platform | Deliberately, with `HQ_PRODUCTION_INTENT=1`, when the platform is healthy |
| Length | about 11 minutes, in two parts (`--part=static`, `--part=production`) | much longer |

## What `gate:safe` runs (all passed on 4 October)

**Static and local** (about 3 minutes): lint, typecheck, the unit and regression tests (4,276), `check:migrations`,
`check:secrets`, `check:templates`, `check:branding`, `check:suite-classes`, `check:ownership`, `check:office-edges`,
`check:carrier-writers`, `check:anon-exposure`, `check:machine-key`, `check:callers`, `check:consumed`, `verify:wired`, and
`verify:basecamp-project-turn` (the page states its project, against a fake office, 37 checks).

**Production, as the Sample or on the test office** (about 8 minutes): `verify:hq` (49 checks of the gateway, converted
from Grant's office to the TEST office, with the tool it presses put back exactly as it was found), `verify:incidents`,
`verify:named-project`, `sample:dock`, `sample:notice-link`, `sample:labels`, and the before/after fingerprint of all 25 offices.
Last result: **10/10, GRANT [], FOREIGN [], SAMPLE []**.

## What it does NOT cover

* Anything that needs a model. A reply's wording, delegation, routing quality, the coherence gates on live answers.
* Voice. **Voice note: MANUAL REAL-MIC ACCEPTANCE REQUIRED. Talk to Team: MANUAL REAL-AUDIO ACCEPTANCE REQUIRED.**
  `verify:talk` was retargeted at Team HQ on 4 October (it used to drive `/classic/`) and is in `gate:safe`'s local part: 36
  checks over a desktop and an iPhone-sized touch leg - the control (44px, hit-tested), the states, the loaded project carried
  in the session request, every microphone track stopped on hang-up, each failure's wording and recovery, no control on the
  portfolio or for a project outside the office. **Its media and connection are SIMULATED**: it proves the control and the
  session boundary and nothing about audio, and it was proved able to fail (project not carried; tracks not stopped).
  `sample:voice` covers the deployed session boundary as the Sample. The two manual acceptances stand.
* The delivery side: nothing here sends to Telegram, Slack, email or a phone.

## What the old gate reaches

Counted from each suite's source for markers (an operator or Grant reference, a vault or operator token, a model-spending path,
a write to a `public` table). **A marker count is not a measurement**: it finds the reach a suite names in its own text, not
what it does through a function it calls. Read it as where to look first. `npm run gate` is 76 checks today (the issue said 37).

**Names an operator or Grant office reach (convert first, in this order):** `verify:history` (10 markers, also 10 model
paths), `check:leaks` (6; read-only, it reads Grant's deliveries to prove nothing escaped), `verify:connectors` (5),
`verify:run3-live` (3), `verify:proposes`, `verify:backups`, `verify:dryrun`, `verify:drains`, `check:standing`,
`check:believes`, `verify:run2-live` (1 each; `check:standing` and `check:believes` are read-only).

**Spends model calls by marker:** `verify:history`, `verify:mytasks`, `verify:resumes`, `verify:unified`,
`verify:artifact-slack`, `verify:collaborates`, `verify:escapes`, `verify:another-go`, `verify:capability-claims`,
`verify:lastword`, `verify:judge` and the live-answer checks. Each is one or more paid turns; none should be run in a loop.

**Writes fixtures into a real office by marker (twelve or more write sites):** `verify:mytasks` (39), `verify:history` (35),
`verify:final-audit-live` (32), `verify:knowledge`, `verify:mail`, `verify:identity`, `verify:run4-live`, `verify:run5-live`,
`verify:tasks`. The convention of this repository (#45) is that a suite testing something that filters fixtures uses a real
subject and tears it down; those suites do, and each is one crashed run from debris, which is the case `check:leaks --sweep`
exists for.

**Read-only by marker (safe to run against production as they stand):** `check:door-origins`, `check:voice-sessions`,
`verify:schema`, `verify:wrappers`, `verify:transitions`, `verify:knows`, `verify:reach`, `check:icons`, `check:pressable`,
`check:tokens`, `check:backend-ref`, `check:one-brain`, `check:reachable`, `check:undo`, `check:answerable`,
`check:system-secrets`, `check:office-raw-sql`, `check:office-conversion`, `check:gateway-wrappers`, plus those already in
`gate:safe`.

## The honest status

* `gate:safe` is green and is safe to run. It is the gate to run for ordinary work.
* The old gate is **not** converted. Converting it means giving each suite its own office (the Sample, or an isolated
  fixture) and a teardown that asserts it left nothing, and it must keep each suite's own controls. That is a project, not a
  patch, and it was not attempted wholesale here: `verify:hq` was converted (the one place it pressed on Grant's real
  specialist's tool), and the rest is listed above in the order it should be done.
* Until then the release status of the old gate is **PARTIAL**, and `gate:safe` plus the manual acceptance in
  `docs/ux/closure-2026-10-03.md` is what stands in for it.
