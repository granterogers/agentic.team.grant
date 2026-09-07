-- 0056 — one person, whatever interface they speak through (§31)
--
-- §31's completion criterion says the same instruction via two interfaces must
-- produce an identical normalized command "modulo `origin_channel`,
-- `origin_ref` and `command_id`". Writing that assertion as a test found that
-- it cannot hold, and the reason is not a bug in either adapter:
--
--   `actor` is a channel-native identifier. Slack says `U0BUNF6AALC`,
--   Telegram says `111222333`, and neither can possibly say the other.
--
-- Adding `actor` to the exempt list would make the test pass and make the
-- criterion meaningless — the whole point of the assertion is that the backend
-- sees one instruction from one person, and an exemption for identity gives up
-- exactly that. So identity gets a channel-independent form instead.
--
-- `subject` already exists as an idea across this schema: preferences are keyed
-- on it, `telegram_chats.subject` carries it, `app.notification_allowed` takes
-- it. It has only ever had one value, 'grant', supplied as a literal by every
-- caller. This gives it a table, so an actor can be resolved TO it rather than
-- assumed.
--
-- ## Why the resolution is not in the adapters
--
-- `toCanonicalCommand` is pure — envelope in, command out, no database. That is
-- deliberate and worth keeping: it is the property that lets both adapters be
-- tested against real wire fixtures without a connection. So the adapters keep
-- emitting the channel-native `actor`, and `subject` is resolved where the row
-- is written. The equality §31 asks for is over the stored command, which is
-- where it matters.
--
-- ## The unknown actor
--
-- Resolution returns null rather than inventing a subject. An unrecognised
-- actor is a real event — someone else in the Slack workspace, a new chat —
-- and mapping them to Grant because he is the only person on file would let a
-- stranger's instruction inherit his preferences and his authority.

begin;

create table public.subject_identities (
  subject         text        not null,
  origin_channel  text        not null,
  actor           text        not null,
  note            text,
  created_at      timestamptz not null default app.now_utc(),

  primary key (origin_channel, actor),
  constraint subject_identities_channel_known
    check (origin_channel in ('slack', 'telegram', 'voice', 'web'))
);

create index subject_identities_by_subject on public.subject_identities (subject);

comment on table public.subject_identities is
  'Which channel-native actor is which person (§31). One row per identity, not '
  'one per person: a human has as many actors as they have interfaces, and the '
  'backend must see one of them.';

insert into public.subject_identities (subject, origin_channel, actor, note)
values
  ('grant', 'slack',    'U0BUNF6AALC', 'Slack user id in T0BUCJ2L5FD'),
  ('grant', 'telegram', '1386648496',  'Telegram chat id — the private chat with the pager bot');

-- Resolve an actor to a person, or to nothing.
create or replace function app.subject_for(p_origin_channel text, p_actor text)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select subject from public.subject_identities
   where origin_channel = p_origin_channel and actor = p_actor
$$;

comment on function app.subject_for is
  'The person behind a channel-native actor, or null. Null is the correct '
  'answer for a stranger: mapping an unknown actor to the only person on file '
  'would let them inherit his preferences and his authority.';

revoke all on function app.subject_for(text, text) from public;
grant execute on function app.subject_for(text, text) to ai_team_app, service_role;

-- The stored command carries it, so §31's equality is over a row that has a
-- channel-independent identity in it rather than over one that cannot.
--
-- A plain column, not a foreign key: the referent would be a subjects table
-- holding one string, and `subject_identities` is keyed on the actor rather
-- than on the person, so there is nothing unique to point at. The value is
-- written by `app.subject_for`, which reads that table — the integrity comes
-- from the writer, and inventing a table to make it declarative would be
-- ceremony.
alter table public.inbound_commands add column subject text;

comment on column public.inbound_commands.subject is
  'The person, resolved from (origin_channel, actor) when the row is written. '
  'Null for an actor we do not recognise, which is a real state and not an '
  'error - see app.subject_for.';

-- Backfill what can be resolved. Nothing is guessed: a row whose actor is not
-- in the table stays null.
update public.inbound_commands c
   set subject = app.subject_for(c.origin_channel, c.actor)
 where c.subject is null;

grant update (subject) on public.inbound_commands to ai_team_app;
grant select, insert on public.subject_identities to ai_team_app;
alter table public.subject_identities enable row level security;
alter table public.subject_identities force  row level security;
create policy subject_identities_app_read on public.subject_identities
  for select to ai_team_app using (true);

commit;
