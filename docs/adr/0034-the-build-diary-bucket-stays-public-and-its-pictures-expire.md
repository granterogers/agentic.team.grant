# ADR-0034 — The build diary's bucket stays public, and its pictures expire

**Date:** 2026-09-16 · **Status:** accepted · **Issue:** #21 · **Migration:** 0413

## Context

`build_steps` (0170) records what the build session is doing so Grant can watch
it at **ai-team-hq.vercel.app → What Claude is building**, and it stores a
screenshot per step in a Supabase Storage bucket called `build`. That bucket is
**public**, which was a convenience decision nobody wrote down.

#21 asked for the decision to be made properly, and named the two reasons to
look again:

1. The screenshots are of the dashboard. They carry project names, document
   titles and, increasingly, document contents. A public bucket is
   world-readable to anyone holding the URL — unlisted is not private.
2. Rows prune at thirty days. **The objects did not.** Measured today: 160
   objects, 74 MB of a 1 GB free tier, and 38 of them belonged to steps that had
   already been pruned.

The obvious answer is the one the `files` bucket already uses (#96, 0205):
private, with a short-lived signed URL minted server-side.

## Decision

**The `build` bucket stays public. The pictures get a retention window.**

## Why not private

Because of an instruction that is explicit and load-bearing. Grant, in
CLAUDE.md:

> *"I can't see anything.. you will always have to give me the image links each
> time to judge."*

Every screenshot of visual work goes into the reply as a URL he can click. A
ten-minute signed URL — the expiry `files` uses, chosen so a URL caught in a
screenshot has expired before anyone else could use it — is a link that is dead
by the time he reads the message that evening. The workflow he asked for stops
working.

The tempting middle, a thirty-day signed URL, is a public URL with extra
machinery: anyone holding it can read the object for a month, and the only
thing bought is a longer string. It adds signing code, a failure mode when
signing fails, and a second expiry to reason about, in exchange for nothing
this threat model cares about.

## What actually makes it acceptable

Not the bucket. Four things around it, and all four have to hold:

1. **The repository the links are pasted into is private.**
   `granterogers/agentic.team.grant` is a private repository, so the Issue
   comments and commit messages carrying these URLs are not public.
2. **The object names are unguessable** — a random session prefix and the
   capture's own name. There is no listing endpoint on a public Supabase
   bucket, so a URL has to leak to be reachable.
3. **A screenshot cannot contain a credential.** The page never renders one:
   the bearer token is never shown on any page, every credential field is a
   password input that is never repopulated with its value, and every secret
   lives in the Vault. `verify:hq` scans the rendered page for six credential
   shapes on every run, each with a synthetic specimen of its own kind as a
   control, so a shape list cannot be quietly weakened until it matches
   nothing.
4. **A leaked URL stops working.** This is the part that did not exist, and
   0413 is it.

Remove any one of those and this decision should be revisited. In particular:
**if the repository is ever made public, this ADR is void** — the URLs become
public with it, and the bucket must go private with signing on the build page.

## The retention window

`app.build_shots_orphaned` lists objects in `build` that no `build_steps` row
points at. The duty `office.prune_build_shots` — Marcus, daily — deletes them
through the storage API.

Two details that are not arbitrary:

- **Orphaned, not old.** The window is the ROW's window, and the object follows
  it. Two windows written separately are two windows that will disagree, which
  is the defect this repository has recorded about copied flags more than once.
- **The deletion is not SQL.** `storage.objects` is a real table and a `delete`
  against it would appear to work: Supabase keeps the bytes behind the storage
  API, so removing the row would leave the object paying for itself for ever
  with nothing left that knows it exists.

## Consequences

- Grant's screenshot links keep working, which is the behaviour he asked for.
- A screenshot URL is readable by anyone who obtains it, for at most thirty
  days.
- The bucket stops growing without bound, and the duty says so when something
  will not delete.
- If the repository goes public, or if the dashboard ever renders a credential,
  this decision has to be made again. Both are named here so the trigger is
  written down rather than remembered.
