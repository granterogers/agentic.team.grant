# ADR-0047 — Migration numbering across concurrent branches

**Status:** accepted, 21 September 2026
**Context:** three Claude sessions writing migrations to one Supabase

## The problem, as it actually happened

Three sessions were live on 21 September — this behavioural-simulation
workstream, the Basecamp frontend, and production-reliability. Their
filesystems are isolated and their branches never see one another. The only
thing that knows which migration numbers exist is the **database**.

`claude/production-reliability` applied `0535` through `0538`. This branch,
which had never seen them, wrote its own `0535`. `npm run migrate` refused,
correctly — and said:

> a migration that has already been applied is no longer in `migrations/`.
> Deleting applied history makes the database unreproducible.

which named the wrong cause. Nothing had been deleted. From inside one
branch, a concurrent branch's migration is indistinguishable from one
somebody removed, and the message only knew about the second case.

While this ADR was being written it happened again: `0540` appeared in the
database from the same branch.

## What was rejected

- **A lock, or a reservation file in the repository.** Both need every
  branch to cooperate, and a session that does not know they exist cannot.
  A reservation nobody honours is worse than no reservation, because it
  reads as a guarantee.
- **Renumbering on merge.** Migrations are immutable once applied;
  `check:migrations` enforces it, and it is right to.
- **Widening the check to tolerate missing files.** The immutability
  property is load-bearing. It should not be weakened to make a
  coordination problem quieter.

## The decision

**Ask the database, which all three branches already write to and which
cannot go stale.**

1. **`npm run migrate:next`** prints the next free number — one past the
   highest *anywhere*, local files and `app.schema_migrations` together —
   and names anything applied to the shared database that this checkout
   lacks, with the two commands that copy it in. Read-only. It reserves
   nothing, deliberately.

2. **`check:migrations` names both causes.** The `checksum/missing`
   message now says that either another branch wrote it — pointing at
   `migrate:next` — or history was deleted here.

3. **The convention:** run `npm run migrate:next` before writing a
   migration, and copy in anything it names before running `npm run
   migrate`. A checkout that migrates a shared database should hold every
   migration applied to it.

## What this does not solve

Two branches that both run `migrate:next` within the same minute can still
pick the same number. This makes the collision **visible immediately and
cheap to fix** — renumber before committing — rather than surfacing as a
refusal several hours later with a misleading message. Given three
autonomous sessions and no shared filesystem, visible-and-cheap is the
achievable property; prevented is not, without a lock that nobody can be
made to take.

It also does not touch the other workstreams. Nothing here changes their
behaviour, requires them to adopt anything, or blocks their migrations.
