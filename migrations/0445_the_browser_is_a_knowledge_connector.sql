-- The browser earns a connector row, and a capability sheet that says no
-- (#135, #51).
--
-- `documents.connector` is a foreign key into `knowledge_connectors`, so a
-- page the office reads cannot be kept at all until the browser is one. That
-- is the schema doing its job: 0444's writer failed on its first drive with
-- `23503`, which is a better outcome than a seventh spelling of "where this
-- came from" accumulating in a free-text column.
--
-- ## The capability sheet is where the gather boundary becomes legible
--
-- #51 gives every connector a sheet of what it can and cannot do, and
-- `capabilityBrief` reads it. So this is the place the gather-only rule stops
-- being a comment in TypeScript and becomes something an agent is TOLD:
-- reading a page is `browser_only` and available; pressing a button on one is
-- `none`, listed, and switched off.
--
-- 0298's rule decides that shape. A capability that does not exist is DISABLED
-- and described, never absent -- because a listed gap can become a proposal
-- (#49) and a missing row is a silence an agent fills in for itself, which is
-- exactly how `task.create` grew an invented four-field intake form.

insert into public.knowledge_connectors (connector, name, automated, enabled, notes)
values (
  'browser', 'Signed-in browser', true, true,
  'A real Chromium, opened somewhere ephemeral for one page at a time and then '
  'destroyed. The SESSION persists in the Vault; the browser does not, because '
  'a process held open between jobs is the one thing in this architecture that '
  'costs money. Reads and photographs. Does not press anything.'
)
on conflict (connector) do update
  set name = excluded.name, notes = excluded.notes, updated_at = app.now_utc();

insert into public.connector_capabilities (connector, verb, returns, reach, cost_note, used_by)
values
  ('browser', 'read a page the office is signed in to',
   'the page''s words, kept as a source document', 'browser_only',
   'ten browser-minutes a day free on Cloudflare''s Workers plan; metered by app.browser_budget',
   'browser.gather'),
  ('browser', 'photograph a page',
   'a PNG in the private files bucket', 'browser_only',
   'counts against the same ten minutes', 'browser.gather'),
  ('browser', 'sign in on Grant''s behalf',
   'nothing — the session is established by a person and stored in the Vault', 'none',
   'a password typed by an agent is a password an agent can be talked into typing', ''),
  ('browser', 'press a button, submit a form, or buy anything',
   'nothing — the gather tier is read-only by design', 'none',
   'acting needs its own approval path (#15), its own verbs and its own migration', '')
on conflict (connector, verb) do update
  set returns = excluded.returns, reach = excluded.reach,
      cost_note = excluded.cost_note, used_by = excluded.used_by;
