# Backend intelligence breadth, routing & multi-agent stress testing

> **Verbatim.** Grant supplied this on 14 September 2026, immediately after the
> routing fix in #230 landed, with the instruction to persist it to GitHub
> before doing any further implementation and before switching to the UX work.
>
> **Every word below is his.** It is stored here as well as in the Issues
> because CLAUDE.md's first rule is that a requirements document is written to
> disk the moment it arrives — a compaction has already destroyed one
> specification in this project.
>
> The Issues that carry this programme are listed at the end of this file, and
> they are the working record. This file is the source they were written from.

---

CRITICAL — PERSIST THIS BEFORE CONTINUING

We are approaching conversation compaction. Do NOT rely on this conversation, your current context window, or memory to preserve the remaining backend-intelligence testing programme.

Before doing further implementation or switching to UX:

1. Inspect the existing GitHub Issues, especially:
   - #224 backend acceptance programme
   - #230 specialist routing/delegation finding
   - #65 and other existing routing/delegation issues
   - any current testing/evaluation/corpus issues

2. Persist the remaining work into GitHub Issues NOW.

Do not create duplicates. Update existing Issues where they already represent the work. Create child Issues only where the work is genuinely distinct.

3. Create/update a durable parent issue/epic representing:

   BACKEND INTELLIGENCE BREADTH, ROUTING & MULTI-AGENT STRESS TESTING

The GitHub backlog must preserve the following facts and requirements independently of this conversation.

CURRENT EVIDENCE

The backend plumbing has extensive deterministic coverage, but intelligence breadth is NOT yet proven.

Production measurement revealed:

- 505 historical routing decisions initially selected only:
  - Emma: 269
  - Claire: 146
  - Tom: 20
  - nobody: 70
- Oliver, Daniel, Ruby, Marcus and Grace had never been selected.
- delegation_depth was 0 across all 505 decisions.
- consultations were only 19 against roughly 267 real instructions.
- verify:delegation and verify:handoff proved mechanisms could work when driven, but did not prove that real traffic actually used them.

Root cause discovered:

`question` was given an empty specialist ceiling before subject-matter routing was evaluated.

Because questions were the most common real intent class, ordinary questions could not reach specialists even when clearly domain-specific.

This was repaired.

After deployment:

- verify:roster improved from 5/7 to 7/7.
- Daniel and Ruby were selected for the first time in production history.
- generic questions without a specialist domain still remain with Claire.
- ambiguous/no-topic branches were protected against accidentally selecting the first specialist.
- fallback vocabulary drift was also identified and partially corrected.

HOWEVER THIS DOES NOT COMPLETE ROUTING ACCEPTANCE.

The production probe still showed:

- only 4 distinct people reached across 8 deliberately targeted asks;
- "where's the bottleneck in onboarding?" failed to reach Marcus;
- "what could go wrong shipping Friday?" failed to reach Grace;
- "enterprise or stay SMB?" went to Ruby rather than Tom;
- several specialists remain unused or insufficiently exercised;
- there is still no convincing production evidence of natural onward delegation;
- historical delegation_depth remains zero.

These misses appear at least partly semantic/vocabulary-related.

Do NOT solve this merely by adding the three exact failed phrases.

The requirement is semantic breadth.

--------------------------------------------------
WORKSTREAM A — SPECIALIST ROUTING BREADTH
--------------------------------------------------

Build a substantially broader specialist-routing acceptance campaign.

For EVERY agent, generate at least 10–20 realistic requests representing the agent's genuine expertise.

Use multiple linguistic forms:

- direct questions;
- commands;
- assignments;
- vague asks;
- conversational language;
- Grant-style stream-of-consciousness;
- speech-to-text imperfections;
- synonyms;
- indirect descriptions;
- terminology absent from obvious keyword lists;
- short requests;
- long multi-clause requests;
- overlapping-domain requests.

Examples should test CONCEPTS rather than exact phrases.

The system should understand, for example, that:

"Where is the bottleneck?"

may be operations/process work without requiring the literal word "process".

Likewise:

"What could go wrong if we ship Friday?"

may require quality/risk reasoning without requiring the literal word "risk".

Do this systematically for every specialist.

Improve staff.expertise where justified, but do not turn it into an enormous brittle synonym dictionary.

If the current architecture fundamentally cannot generalise beyond keywords, identify that as an architectural limitation rather than endlessly adding phrases.

--------------------------------------------------
WORKSTREAM B — ROUTING CONFUSION MATRIX
--------------------------------------------------

Record intended specialist versus actual selection.

Produce a confusion matrix including:

- intended specialist;
- selected specialist(s);
- correct;
- acceptable alternative;
- incorrect specialist;
- Claire fallback;
- clarification requested;
- consultation invoked;
- delegation invoked.

Measure per-agent routing accuracy.

Specifically identify systematic domination such as Emma/Claire/Ruby absorbing work belonging to other specialists.

--------------------------------------------------
WORKSTREAM C — NEGATIVE CONTROLS
--------------------------------------------------

Do NOT optimise for "always select a specialist".

Test cases where Claire SHOULD remain alone.

Examples:

- trivial retrieval;
- simple project-state questions;
- basic conversational questions;
- requests requiring no specialist expertise.

Also test ambiguous requests where clarification is preferable to arbitrary routing.

False-positive delegation is a defect too.

--------------------------------------------------
WORKSTREAM D — OVERLAPPING DOMAINS
--------------------------------------------------

Test prompts legitimately spanning multiple specialties.

Examples:

- finance + strategy;
- growth + communications;
- operations + quality;
- research + strategy;
- finance + growth;
- communications + quality.

Verify whether the system selects, consults or delegates appropriately.

Do not grade these using one rigid "correct agent" when multiple answers are reasonable.

Grade the behavioural property.

--------------------------------------------------
WORKSTREAM E — REAL MULTI-AGENT COLLABORATION
--------------------------------------------------

This is mandatory.

Construct realistic tasks that genuinely require two or more specialists.

Inject them through the SAME canonical inbound path used by real user messages.

Then inspect canonical state.

Prove:

- primary routing occurred;
- appropriate specialist(s) were actually invoked;
- consultations were actually created where appropriate;
- handoffs actually occurred where appropriate;
- delegation was real rather than nominal attribution;
- intermediate specialist work influenced the final result;
- Claire correctly coordinated the result;
- the system did not merely generate prose pretending collaboration occurred.

Assert against routing_decisions, consultations, jobs, traces/provenance and other canonical evidence.

Output attribution is NOT evidence of delegation.

A passing verify:delegation mechanism test is NOT evidence that natural requests cause delegation.

The target is to demonstrate delegation_depth > 0 for requests where collaboration genuinely warrants it.

Also demonstrate that unnecessary collaboration is avoided.

--------------------------------------------------
WORKSTREAM F — AGENT ACTION/CAPABILITY COVERAGE
--------------------------------------------------

For every agent, inventory what that agent is actually allowed and expected to do.

Map:

AGENT
→ EXPERTISE
→ DECLARED CAPABILITIES
→ TOOLS
→ PERMISSIONS
→ ACTIONS
→ TESTED ACTIONS
→ ACTUALLY OBSERVED ACTIONS

Distinguish:

1. capability exists in code;
2. capability has a deterministic test;
3. capability can be invoked deliberately;
4. router naturally selects it;
5. agent actually uses it correctly;
6. it has been observed in realistic traffic.

Do not describe 1–3 as proof of 4–6.

Identify tools/actions assigned to agents that have never actually been exercised.

--------------------------------------------------
WORKSTREAM G — INTELLIGENCE BREADTH CAMPAIGN
--------------------------------------------------

Preserve a future large-scale intelligence stress campaign.

Do NOT reduce this to 200 random prompts.

Build a coverage model spanning:

- every agent;
- every declared capability;
- every meaningful tool/integration;
- every major task domain;
- research;
- analysis;
- planning;
- recommendations;
- creation;
- actions;
- project management;
- software/project reasoning;
- business strategy;
- monetisation;
- finance;
- marketing/growth;
- communications;
- operations;
- quality/risk;
- connected knowledge;
- project-scoped work;
- cross-project work;
- memory-dependent work;
- single-agent work;
- multi-agent work;
- tool-heavy work;
- no-tool reasoning;
- permission-gated actions;
- unavailable capabilities;
- provider failures;
- malformed inputs;
- contradictory instructions;
- corrections;
- changed intent;
- ambiguous requests;
- long multi-clause instructions;
- voice-note / speech-to-text style requests;
- hallucination traps.

Create three execution tiers:

TIER 1 — PERMANENT SMOKE CORPUS
Approximately 50–100 high-value cases.
Fast enough for regular regression use.

TIER 2 — READINESS CORPUS
Approximately 300–500 representative cases.
Used before significant releases/human acceptance phases.

TIER 3 — DEEP STRESS CORPUS
2,000+ systematically generated/mutated cases.
Used deliberately rather than on every commit.

Do NOT run Tier 3 merely because this issue exists.

First build the coverage matrix and determine what dimensions are actually represented.

--------------------------------------------------
WORKSTREAM H — MUTATION TESTING
--------------------------------------------------

Take successful and failed requests and generate nearby semantic variants.

Example:

"What does cutting price 15% do to gross margin?"

should generate variants such as:

- "If we knock fifteen percent off, what happens to margin?"
- "Can we afford to discount this?"
- "How badly would a price reduction hurt profitability?"
- "Run the numbers if we sell it cheaper."
- speech-to-text/noisy variants.

The objective is to test whether routing understands the concept rather than memorising wording.

Every genuine routing defect should produce permanent nearby regression variants.

--------------------------------------------------
WORKSTREAM I — PRODUCTION UTILISATION TELEMETRY
--------------------------------------------------

Persist measurement for:

- agent selection frequency;
- percentage of traffic reaching each specialist;
- consultation frequency;
- delegation frequency;
- delegation depth;
- tool invocation frequency;
- per-agent tool usage;
- unused capabilities;
- capabilities tested but never naturally invoked;
- agents theoretically available but never selected;
- routing fallbacks;
- clarification frequency;
- latency by routing/delegation shape.

The system must distinguish:

"this mechanism works when a test forces it"

from:

"the office actually uses this mechanism appropriately."

--------------------------------------------------
WORKSTREAM J — RESPONSE LATENCY / WORKER HEALTH
--------------------------------------------------

Preserve the Stage 2 finding permanently.

Measured real instructions had approximately:

- median execution around 53 seconds;
- severe long-tail delays;
- worst observed delay around 15 hours.

Investigation proved the long tail was predominantly QUEUE WAIT, not model execution.

During the major incident:

- jobs themselves ran in under roughly one minute once started;
- eleven messages waited for hours;
- the worker was effectively absent for approximately 15 hours;
- pg_cron nevertheless recorded 1,440 successful heartbeat requests;
- heartbeat success proved only that an HTTP request was made;
- office_health had no meaningful representation for queued work that had never started.

verify:drains was therefore added.

It must permanently prove the PROPERTY:

real work must not remain waiting beyond the acceptable threshold.

The guard should catch:

- dead worker;
- stranded queue;
- expired/exhausted lease;
- provider outage preventing consumption;
- stuck committing/committed/notifying state where applicable.

Also prove:

- an idle office does not falsely fail;
- a deliberately non-draining queue makes the check RED;
- resumed processing returns it GREEN;
- queue/waiting health is visible operationally;
- a successful heartbeat cannot mask a non-draining worker.

--------------------------------------------------
WORKSTREAM K — HISTORICAL FAILURES BECOME REGRESSIONS
--------------------------------------------------

Every genuine defect discovered in this programme must become a permanent regression property.

Do not test only the literal phrase that exposed it.

Capture the invariant.

Examples from this programme include:

- questions structurally unable to reach specialists;
- ambiguous questions accidentally selecting ceiling[0];
- expertise/fallback vocabulary drift;
- specialist theoretically available but never naturally selected;
- delegation mechanism existing but never naturally invoked;
- heartbeat reporting healthy while queue does not drain;
- health checks ignoring never-started waiting jobs;
- vacuous tests passing because they matched zero rows;
- harness traffic being mistaken for production failures.

--------------------------------------------------
ACCEPTANCE CRITERIA
--------------------------------------------------

Do NOT call backend intelligence routing complete merely because verify:roster is green.

Before this epic is complete, provide evidence that:

1. all intended specialists are genuinely reachable;
2. each specialist succeeds across varied natural-language formulations;
3. routing does not depend on a handful of exact keywords;
4. trivial work correctly stays with Claire;
5. ambiguous work is handled sensibly;
6. overlapping-domain work behaves sensibly;
7. genuine multi-agent tasks cause actual collaboration;
8. delegation/consultation is evidenced in canonical state;
9. unnecessary delegation is avoided;
10. agent capabilities/actions have been inventoried and meaningfully exercised;
11. production utilisation can reveal dormant agents/tools/capabilities;
12. response/queue health detects a non-working office despite successful heartbeat traffic;
13. discovered defects become permanent regressions;
14. the larger intelligence breadth campaign has a durable coverage model and execution plan.

--------------------------------------------------
GITHUB / COMPACTION REQUIREMENT
--------------------------------------------------

THIS IS THE MOST IMPORTANT IMMEDIATE INSTRUCTION:

Before continuing implementation:

- persist this programme into GitHub;
- update #230 where appropriate;
- update #224 where appropriate;
- create child issues only for genuinely distinct workstreams;
- cross-link dependencies;
- add acceptance criteria;
- preserve current measured evidence;
- record what has already been fixed;
- record what remains unproven;
- update HANDOFF/HANDOVER if that is the repository convention.

Do not depend on this Claude conversation surviving compaction.

GitHub is the durable project memory.

After the issues are created/updated, commit/push any necessary documentation changes.

Then tell me exactly which GitHub Issues now preserve this programme.

Only after confirming that the programme is durably represented in GitHub should you continue execution.

Do not switch to the UX P0 work until this critical backend-intelligence testing programme is safely captured in GitHub.
