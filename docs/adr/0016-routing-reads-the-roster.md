# ADR-0016 — Routing reads the roster, and the roster is data Grant edits

**Date:** 2026-09-11 · **Status:** accepted
**Implements #65. Constrains #50.**

---

## What Grant asked for

> "I still don't really fully understand the role of the individual agents when I send Claire to do something. If it's truly being delegated, if it's just one bot now doing all the work, it's not really what we want, is it?"

And, decisively for the design:

> "when it comes to the dashboard, we're going to look at each agent, what their skill sets are, what tools they have access to, and adjust and add and refine. So it's very important that we get this right… This whole concept is the core of the agentic workforce."

## What was actually true

Measured over 30 days of real work:

| | |
|---|---|
| jobs carrying a `recipient_agent` | 0 of 499 |
| rows in `consultations` | 0, ever |

The router was **not** missing. `route()`, `pickRoster()` and `routing_decisions` all existed and worked, with reasons recorded. `speaker()` was already choosing a specialist per message. The decision was made, written to `routing_decisions`, and then **not applied to the job**. Nothing downstream could answer "who took this", so it looked exactly like no delegation at all.

## The decision

**Three changes, and only one of them is about routing logic.**

1. **The decision reaches the job.** `jobs.recipient_agent` is set from the chosen speaker. This is most of the perceived problem and it is nearly free.
2. **A hand-off is recorded as a consultation**, so §9's economics question has data. `changed_outcome` is deliberately left null at this point: recording a consult is not a claim that it helped, and a table that assumed so would answer its own question.
3. **Subject-matter routing reads `staff.expertise` instead of `TOPIC_ROLES`.**

The third is the one that matters for what he is building.

## Why the vocabulary had to move out of TypeScript

`TOPIC_ROLES` is five regexes in `src/agents/router.ts`. It routed correctly for months. It is also the single thing Grant cannot change, and he is building a dashboard whose entire purpose is changing it.

`CLAUDE.md` already ranks this above most other goals:

> *"I want to reduce my dependence on Claude or another coding interface for maintaining and extending the system."*

A capability that exists only as a regex I maintain is a capability he does not have. So the words live in `staff.expertise` — a column — and `app.who_knows_about()` matches against it. **Editing a row now changes who gets the work**, and `verify:delegation` asserts exactly that by teaching a specialist a nonsense word and watching the routing follow.

The hardcoded list stays as a fallback rather than being deleted. If the database is unreachable or a column is emptied by mistake, routing degrades to yesterday's behaviour rather than to "Claire answers everything" — which is the complaint being fixed.

## What the research changed

Current practice on multi-agent orchestration converges on five patterns — fan-out, pipeline, debate, supervisor, swarm — and recommends **supervisor** for the widest framework support and the best-understood failure modes. That is what this office already is.

Two findings did change the design:

- **Route to a capability, then resolve to an agent.** Naming agents at the call site couples every caller to the roster. Here the caller supplies a *subject* and the roster resolves it, so changing who owns pricing is one row.
- **Capability is contextual, not a static label.** A single score per agent is not enough, so `who_knows_about` returns ranked candidates *with the matched terms*. A routing decision nobody can question is one nobody can correct.

**Deliberately not adopted:** bidding, debate and swarm. Each spends several model calls to decide who should spend one, against a ~£0/month budget, for a roster of eight whose remits barely overlap.

## Why lexical matching and not embeddings

An embedding would route "how much should I charge" to finance without the word "cost" appearing. It also needs a paid API or a model call per message. `extensions.similarity` is free and already in use, and where nothing matches, §9's intent ceiling still answers.

Two refinements were needed and both are explainable in a sentence, which is the point — Grant has to be able to reason about why Emma got something:

- **A shared four-character prefix** counts as a match: `write`/`writing`, `source`/`sources`, `forecast`/`forecasting`. Scored just below exact containment so a real match always wins.
- **Sum, not max**, across matched terms: an instruction touching three of someone's terms is more theirs than one touching a single term exactly.

The gap is measurable in `routing_decisions.roster_reason`, and can be revisited with evidence rather than preference.

## The constraint that stops this going wrong

**More delegation is not better.** Grant hears only from the chief of staff, so every hand-off must stay invisible unless it changes what he receives. A team that visibly passes his request around three times before answering is worse than one bot.

§9's ceilings therefore remain the cost control, and expertise may only narrow within them, never widen them. `verify:delegation` asserts that a request touching every subject still names at most three people.

The test is not "how many agents touched it". It is: **could Grant tell, from the answer, that the right person did it?**

## Consequence for anyone extending this

If you find yourself adding a subject keyword to a TypeScript file, you are undoing this. The words belong in `staff.expertise`, and the dashboard is the place they get edited.
