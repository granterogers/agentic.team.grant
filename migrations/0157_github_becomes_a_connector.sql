-- GitHub becomes a connector.
--
-- Grant, §8: *"GitHub should be supported as a first-class connector"* — public
-- repositories by name or URL, private ones through an authenticated
-- connection, and once his identity is known, *"Look at my Rest Timer GitHub
-- repo"* resolving without a URL.
--
-- The audit found GitHub was not a connector at all. It was one string,
-- `system_config.github.repository`, naming the repository this system's own
-- code lives in — which is a fact about the deployment, not a project the team
-- works on. Meanwhile `project_attachments.connector` is a foreign key to
-- `knowledge_connectors`, so there was no legal way to attach a repository to
-- anything.
--
-- That constraint is why this migration is short. The project model already
-- carries attachments, roles, enablement and disabled reasons; adding one row
-- to `knowledge_connectors` makes a repository a first-class attachment
-- everywhere at once, with no new join and no parallel table. Repairing rather
-- than paralleling was the instruction, and here the existing design simply
-- had the socket.
--
-- ## Why a fine-grained token, and not an OAuth app
--
-- §13 puts "exposing private repositories" in the highest risk tier, so the
-- question is which mechanism gives the least away. A fine-grained personal
-- access token is scoped to repositories Grant picks one at a time, is
-- read-only unless he says otherwise, expires, is revocable from a page he can
-- find, and installs nothing on his account. An OAuth app or a GitHub App would
-- need a callback endpoint to defend, an app registration to keep, and a
-- consent screen that grants far more than "read these four repositories".
--
-- The token is not in this migration. It goes in the vault, by hand, from
-- Telegram — never through a terminal (§15).
--
-- ## Read is registered; write is registered and refused
--
-- `github.write` exists as a row so that the answer to "can the team push?" is
-- a lookup rather than an absence. §13 puts destructive GitHub operations in
-- tier 3, and a capability that is merely missing tends to get added by
-- whoever needs it next; one that is present and disabled has to be argued
-- with.

begin;

-- ---------------------------------------------------------------------------
-- The connector
-- ---------------------------------------------------------------------------

insert into public.knowledge_connectors (connector, name, enabled, automated, notes)
values (
  'github', 'GitHub', true, true,
  'Official REST API, documented rate limits, no policy exposure — a '
  'first-class connector under ADR-0013, in the same tier as Notion. Public '
  'repositories need no credential at 60 requests an hour per address; private '
  'ones need a fine-grained token in the vault as `github.token`, which also '
  'raises the limit to 5,000. Read-only: `github.write` is registered at risk 3 '
  'and disabled (§13).'
)
on conflict (connector) do update
  set name       = excluded.name,
      enabled    = excluded.enabled,
      automated  = excluded.automated,
      notes      = excluded.notes,
      updated_at = app.now_utc();

-- ---------------------------------------------------------------------------
-- Whose GitHub
-- ---------------------------------------------------------------------------
--
-- Seeded from the owner half of `github.repository`, which is already correct
-- and already his. Kept as its own key because the two mean different things
-- and will drift: `github.repository` is where this system's code lives, and
-- `github.owner` is the account whose repositories the team may be asked about.

insert into public.system_config (key, value, description)
select
  'github.owner',
  to_jsonb(split_part(c.value #>> '{}', '/', 1)),
  'The GitHub account whose repositories the team can be asked about, so '
  '"my Rest Timer repo" resolves without a URL. Distinct from '
  '`github.repository`, which is where this system''s own code lives.'
  from public.system_config c
 where c.key = 'github.repository'
   and split_part(c.value #>> '{}', '/', 1) <> ''
on conflict (key) do nothing;

-- Deliberately NOT in `subject_identities`.
--
-- That table looked like the obvious home — it already carries Grant on Slack,
-- Telegram and voice, and §8 is about a repository being "mine". But its
-- primary key is `(origin_channel, actor)` and a check constraint limits the
-- channel to slack, telegram, voice and web. Those are the surfaces a message
-- can ARRIVE from, and the table's job is to recognise the sender of one.
--
-- GitHub is not a surface Grant messages from. Widening the constraint to fit
-- a username in would have made the table mean two things, and the next person
-- reading "identities" would have to know which rows are senders and which are
-- accounts. One config key says the same thing without the ambiguity.

-- ---------------------------------------------------------------------------
-- What the team may do with it
-- ---------------------------------------------------------------------------

insert into public.tool_permissions (tool, level, description, enabled, disabled_reason)
values
  ('github.read', 0,
   'Read a GitHub repository: metadata, branches, README and docs, the source '
   'tree, file contents, open issues and releases.',
   true, null),
  ('github.write', 3,
   'Create or change anything in a GitHub repository.',
   false,
   '§13 puts destructive GitHub operations in the highest tier. There is no '
   'automated path to this in V1, and src/github/api.ts contains no method '
   'that writes — the absence is structural, not just a flag.')
on conflict (tool) do update
  set level           = excluded.level,
      description     = excluded.description,
      enabled         = excluded.enabled,
      disabled_reason = excluded.disabled_reason;

-- A row IS the grant in this table — there is no boolean, and a person without
-- a row simply does not have the tool.
insert into public.staff_tools (staff_slug, tool, granted_by, note)
select s.slug, 'github.read', 'migration 0157',
       'Reading a public repository is the same class of act as reading the '
       'web, which everyone already has. Sight of a PRIVATE repository is not '
       'granted here — it depends entirely on what the vault token was scoped '
       'to, which is Grant''s choice one repository at a time.'
  from public.staff s
 where s.active
on conflict (staff_slug, tool) do nothing;

commit;
