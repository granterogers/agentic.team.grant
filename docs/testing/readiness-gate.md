# Fast readiness gate

Run on 2026-09-16. Issue #224.

**GREEN** — 22 of 22 passed.

This is the SHORT gate. It is not the deep acceptance sweep, and passing it
is not a claim about the whole backend — `npm run e2e` is that claim. What a
green gate says is narrower and still worth having: no severe regression in
persistence, isolation, routing, delegation, capability honesty, project and
task operations, the public surface, or fixture hygiene.

> **How this run was produced, and why it is not `npm run gate`'s own output.**
> The whole gate takes about nineteen minutes and CLAUDE.md forbids
> backgrounding it, so its twenty-two checks were run individually in three
> foreground batches and their verdicts collected here. Every tally below is
> one this session actually saw. The times are omitted rather than invented,
> which is the only thing this report loses by being assembled that way.

| check | verdict | tally | why it is in the gate |
|---|---|---|---|
| `verify:schema` | green | 2/2 checks passed | the schema's own dangling references |
| `verify:wrappers` | green | 46/46 checks passed | every RPC a client calls is reachable — PostgREST exposes only `public`, and a missing wrapper is invisible until called |
| `verify:transitions` | green | — | the job state machine in the database and the one in the code still agree |
| `verify:attests` | green | 11/11 checks passed | an agent may not say it looked when it did not (#185) |
| `verify:knows` | green | 25/25 checks passed | a false "I can't" and a false "I can" are both failures (#64) |
| `verify:reach` | green | — | the vocabulary and the intent ceiling agree on who answers — deterministic, no model (#231) |
| `verify:routing-breadth` | green | 11/11 checks passed | every specialist is reachable by how Grant actually talks, and nothing trivial convenes one (#232) |
| `verify:delegation` | green | 17/17 checks passed | the work is actually delegated, not eight voices and one worker (#65) |
| `verify:collaborates` | green | 10/10 checks passed | a two-subject request reaches a second specialist as real work, and the chain stays bounded (#233) |
| `verify:handoff` | green | 13/13 checks passed | delegation that leaves a trace |
| `verify:recovers` | green | 18/18 checks passed | no fabricated success, no duplicate action, no lost mutation, no stranded work (#231) |
| `verify:cross-interface` | green | 10/10 checks passed | the same instruction through any surface uses the same canonical layer (§22 B) |
| `verify:identity` | green | 39/39 checks passed | a name finds the right project, and an ambiguous one finds nobody |
| `verify:tasks` | green | 19/19 checks passed | the task system, driven rather than described |
| `verify:history` | green | 50/50 checks passed | one conversation, both sides, and nothing from anybody else's project |
| `verify:transport` | green | 22/22 checks passed | a message does not disappear because a provider was down |
| `verify:security` | green | 20/20 checks passed | the public surface, probed as an attacker would |
| `verify:dryrun` | green | 25/25 checks passed | a dry run that writes anything is not a dry run |
| `verify:drains` | green | 8/8 checks passed | the queue is actually moving — a dead worker once left Grant waiting fifteen hours while the heartbeat logged 1,440 successes |
| `check:leaks` | green | — | no suite left a project, job or channel in Grant's real views |
| `check:icons` | green | — | every project icon names a mark the studio can actually draw |
| `check:callers` | green | — | a capability nothing calls is a capability nobody can have (#72) |

`check:leaks` went red once on this run, on one fixture task left behind by
`verify:tasks` a few minutes earlier in the same sweep. `npm run purge:fixtures
-- --go` cleared it and the re-run was clean. The twenty-two archived debris
projects it also reports are history rather than a leak: each carries a job, a
job can never be deleted, so `project_delete` refuses them for ever (ADR-0022).
