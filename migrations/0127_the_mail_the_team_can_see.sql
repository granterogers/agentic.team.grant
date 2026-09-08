-- 0127 — The mail the team can see
--
-- Grant asked for Gmail, Drive and YouTube, and 0123 gave each a Connect
-- button. A button that connects to nothing is worse than no button: it reports
-- success and changes nothing, which is the failure shape this project keeps
-- finding. This is the half that makes the Gmail button mean something.
--
-- Modelled on `calendar_events` (0109) on purpose. That pattern is proven here:
-- cache what was seen, answer from the cache, and go on answering when Google
-- is unreachable (§18 case 3). Two different shapes for two Google readers
-- would be two sets of bugs.
--
-- ## What is stored, and what is deliberately not
--
-- Headers, a short excerpt, and labels. NOT the body.
--
-- The calendar stores an excerpt for the same reason: enough to tell two
-- "Catch-up" entries apart, not enough to be a copy of the thing. Mail is
-- stronger — it is other people's words about other people, and a full local
-- copy of an inbox is a liability that grows every hour whether or not anyone
-- reads it. When the team needs the body of one specific message it can fetch
-- that message; §1 says adapters do not pre-digest, and hoarding is the
-- opposite failure.
--
-- No attachments, ever. `has_attachments` is a boolean because "was there a
-- file" answers most questions and storing the file answers none of them.
--
-- ## Why `from_address` is split out
--
-- "Who has been emailing about the invoice" is the question actually asked, and
-- answering it from a `From:` header parsed at read time means parsing it
-- differently every time. Parsed once, on the way in.

begin;

create table public.mail_messages (
  -- Gmail's own id, stable across label changes, which makes a refresh an
  -- upsert rather than a delete-and-reload.
  message_id      text        primary key,
  thread_id       text        not null,

  subject         text,
  from_name       text,
  from_address    text,
  -- Recipients as a count and nothing more, matching the calendar's decision
  -- not to store attendee names.
  to_count        integer     not null default 0,

  sent_at         timestamptz,
  -- A short excerpt. Gmail calls it a snippet and gives it to us for free in
  -- the list response, so this costs no extra request.
  excerpt         text,
  labels          text[]      not null default array[]::text[],
  has_attachments boolean     not null default false,
  unread          boolean     not null default false,

  first_seen_at   timestamptz not null default app.now_utc(),
  last_seen_at    timestamptz not null default app.now_utc(),
  -- Set when a message we had cached is no longer returned: deleted, or moved
  -- somewhere the query does not look. Not deleted locally, so "what happened
  -- to that email" has an answer (§16).
  vanished_at     timestamptz,

  constraint mail_messages_excerpt_is_an_excerpt check (length(coalesce(excerpt, '')) <= 400)
);

comment on table public.mail_messages is
  'Recent mail, cached so the team can answer questions about it quickly and '
  'can go on answering when Google is unreachable (§18). Headers and a snippet '
  'only — never bodies, never attachments.';

create index mail_messages_recent on public.mail_messages (sent_at desc)
  where vanished_at is null;
create index mail_messages_from on public.mail_messages (from_address)
  where vanished_at is null;

alter table public.mail_messages enable row level security;
alter table public.mail_messages force  row level security;
grant select on public.mail_messages to ai_team_app;
create policy mail_messages_app_read on public.mail_messages
  for select to ai_team_app using (true);

-- §17: disableable, with the switch in the same place as the calendar's.
insert into public.system_config (key, value, description)
values ('gmail.enabled', to_jsonb(false),
        'Whether the team reads mail at all. Off until Grant connects Gmail '
        'and turns it on — a connected account is permission, not instruction.')
on conflict (key) do nothing;

/**
 * What has arrived, as the team would say it.
 *
 * A function rather than a view for the reason `calendar_ahead` is: the voice
 * surface and the front end ask the same question over different windows, and
 * two hand-written versions of "recent mail, newest first" would eventually
 * disagree about what recent means.
 */
create or replace function app.mail_recent(p_hours integer default 24, p_limit integer default 20)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(m order by m.sent_at desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'subject', coalesce(subject, '(no subject)'),
               'from', coalesce(nullif(from_name, ''), from_address, 'unknown'),
               'from_address', from_address,
               'sent_at', sent_at,
               'excerpt', excerpt,
               'unread', unread,
               'has_attachments', has_attachments
             ) as m, sent_at
        from public.mail_messages
       where vanished_at is null
         and sent_at > app.now_utc() - make_interval(hours => greatest(1, least(720, p_hours)))
       order by sent_at desc
       limit greatest(1, least(100, p_limit))
    ) m
$$;

grant execute on function app.mail_recent(integer, integer) to ai_team_app, service_role;

-- A duty, so it refreshes itself rather than only when something asks. Same
-- cadence as the calendar: often enough to be current, rarely enough that the
-- free tier does not notice.
-- `staff_id` is a uuid and the column is `period_minutes`, not
-- `cadence_minutes`. Both were guessed the first time and Postgres refused
-- them, which is the schema doing its job — and the same class of mistake that
-- 0128 had to repair in `dequeue_job`, caught here for free because an insert
-- names its columns.
insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled)
select
  'mail-refresh',
  s.staff_id,
  'Read what has arrived in the inbox, so the team can answer questions about '
  'it without waiting on Google.',
  'google.read_mail',
  60,
  -- Off until Grant connects Gmail AND turns it on. A duty that fires against
  -- an unconnected service would fail hourly and teach everyone to ignore it.
  false
  from public.staff s
 where s.slug = 'chief-of-staff'
on conflict (slug) do nothing;

commit;
