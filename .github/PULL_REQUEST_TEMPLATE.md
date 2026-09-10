## What changed

<!-- The change, in a few sentences. -->

## Why

<!-- The problem it solves. Quote Grant's words where they exist — they are
     usually a better statement of the problem than a paraphrase. -->

Closes #

## Decisions worth noticing

<!-- Anything a reviewer could otherwise reverse by accident. If it is big
     enough to deserve an ADR, say which one. -->

## How it was verified

<!-- What you actually ran, and what it said. "Tests pass" is not this.
     Name the harness and the count: verify:hq 40/40, 859 unit tests. -->

- [ ] `npm run lint && npm run typecheck && npm run test`
- [ ] `npm run check:migrations && npm run check:secrets`
- [ ] Relevant `npm run verify:*` harnesses
- [ ] Visual QA at phone and desktop, if the UI changed

## Migrations and configuration

<!-- New migration numbers, new environment variables (names only, never
     values), anything that must be deployed in a particular order. -->

## Known limitations and follow-ups

<!-- What this deliberately does not do. Open an Issue for each and link it —
     a follow-up recorded only here is a follow-up that gets lost. -->
