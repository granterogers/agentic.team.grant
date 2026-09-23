# Contacts: editing needs a database change this branch may not make

**Status: NOT APPLIED, NOT DEPLOYED. Deliberately.**
Written 23 September 2026 on `claude/basecamp-team-hq`.

## What this is

Grant asked, on 22 September, for contacts to be genuinely editable:

> *"Existing contacts must be editable. Grant should be able to open a contact
> and: change existing data; add missing data; replace/remove the image; add or
> update website/social information; edit notes... Notes must not be read-only
> decoration."*

The interface for that is built, wired and verified — `verify:basecamp-contacts`
passes 23/23 — but **against the prototype's own memory, in the browser**. Every
field it edits is kept in `localStorage` for rows the office has no record of.
The moment those contacts are real office rows, the same controls need a writer,
and the office has never had one: migration 0245 gave `public.contacts` every
column Grant asked for and exactly one door, which CREATES. There is no update
path, so a typo in an email address is permanent by construction.

## Why this branch did not just apply it

This is the UX workstream. It does not own the database, and the main workstream
is applying migrations to it daily: on 23 September production was at
**0565**, applied that morning, while this branch carries **533**.

That is not a numbering inconvenience, it is the collision Grant's instruction
names. The file was first written as `0534_a_contact_can_be_corrected.sql`;
production already has a different `0534_the_harness_can_ask_to_see_its_own_projects.sql`,
applied on 21 September. Numbered above main's head it leaves a 32-file gap that
`check:migrations` refuses — correctly, because the gap is real.

So the SQL is held, unnumbered, at
**`docs/basecamp/pending/a-contact-can-be-corrected.sql`**, and nothing has been
applied to the production database or deployed to the production gateway from
this branch.

## The three pieces, and where each one is

| Piece | Where it is now | State |
|---|---|---|
| The SQL — `contacts.image_url`, `app.hq_contact_update`, its public wrapper, grants, and the reader updated to return the new column | `docs/basecamp/pending/a-contact-can-be-corrected.sql` | written, **unapplied**, unnumbered |
| The gateway action — `contact_update: { fn: 'hq_contact_update', required: ['p_contact_id'] }` | `supabase/functions/hq-api/index.ts:723`, committed on this branch in `beec14d` | committed, **undeployed** |
| The interface — the record, every field, the image upload and removal, validation, the note | `web/studio/bc/shell.js`, `web/studio/bc/wire.js`, `web/studio/bc/contacts.js` | built and verified against the prototype memory |

## To land it

In this order. Steps 1 and 2 change production; do them from whichever
workstream owns the database, not casually.

**1. Number the migration against main's head at that moment.**

```bash
git fetch origin main
ls migrations | tail -3                 # main's head, e.g. 0571_…
cp docs/basecamp/pending/a-contact-can-be-corrected.sql \
   migrations/0572_a_contact_can_be_corrected.sql   # next free number
npm run check:migrations                # must pass: no gap, no collision
```

Replace the header's PENDING paragraph with the ordinary migration heading. A
file whose number is already recorded with a different checksum fails
`check:migrations`, which is the check doing its job — renumber, never edit an
applied migration.

**2. Apply it, and prove it took.**

```bash
npm run migrate
npm run q -- "select count(*) from information_schema.columns
              where table_schema='public' and table_name='contacts'
                and column_name='image_url'"                      # expect 1
npm run q -- "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='app' and p.proname='hq_contact_update'"  # expect 1
npm run q -- "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='hq_contact_update'"  # expect 1
```

Both counts were **0** when this was written, on 23 September at 09:30 UTC.

PostgREST only exposes `public`, so the wrapper is not optional — and
`create or replace function` does not replace a function whose argument list
changed, so if a later revision alters the signature, drop by exact signature
first.

**3. Deploy the gateway, which is what makes the action reachable.**

```bash
npm run deploy:hq          # page + hq-api, and it probes itself
```

A migration is not a deploy: the action at `index.ts:723` is committed here and
is not in the running function until this is done.

**4. Prove the door actually opens, by driving it rather than reading it.**

```bash
npm run verify:basecamp-contacts       # 23/23 today, against the prototype memory
```

and then the part no current suite can reach, because it needs a real contact
row and a real token: open a contact on the deployed page signed in, change the
email address, reload, and confirm it stayed. Until that has been done by
somebody with a token, contacts editing is **BUILT and INTERACTION VERIFIED and
not REAL BACKEND VERIFIED**, and the acceptance report says exactly that.

## What it unlocks, and what breaks without it

With it: every contact field Grant listed becomes editable against the office,
for real rows, from the interface that already exists.

Without it: the interface works on the prototype's contacts and, for a real
office contact, the save has nowhere to go. `attempt()` reports the office's own
refusal beside the control — it does not claim success, which
`verify:basecamp-failures` proves — so the failure is honest. It is still a
feature Grant asked for that he does not have.

## Rollback

The migration is additive: one nullable column with a CHECK on its shape, one
function, one wrapper. To undo, drop the function and wrapper by exact
signature; the column can stay — dropping it would discard any image already
stored, which is a destructive action and needs Grant's confirmation.
