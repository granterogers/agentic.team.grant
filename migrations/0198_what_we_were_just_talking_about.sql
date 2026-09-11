-- What we were just talking about.
--
-- Issue #63. Grant: *"it's struggling a little bit with what I just said about
-- the coaching for success message. Seems to have problems recalling what we
-- talked about before."*
--
-- There is no conversation. Every message becomes an `office.instruction` job
-- handled with only its own text. `inbound_commands` has recorded every message
-- he has ever sent and nothing has ever read them back.
--
-- The one thing that looks like memory is `pairWithNearby`, and it is not:
-- it joins a LINK to an instruction fragment inside six minutes. Its own
-- comment says *"a link sent twenty minutes after an instruction is a new
-- subject."* That is a caption-and-attachment rule, not recall.
--
-- So every pronoun fails. "Make the audio one long" arrives with no idea what
-- "the audio" is, and #60's plan parser is handed a sentence with no subject
-- and blamed for missing half of it.
--
-- ## Both sides, or it is not a conversation
--
-- The obvious version returns his last few messages. That is half a
-- conversation and the wrong half: what he is referring to is usually
-- something CLAIRE said — "the audio one" refers to her say-back, not to his
-- own earlier sentence. So this returns the exchange, interleaved: what he
-- said, and what went back to him.
--
-- ## Scoped exactly as pairing is scoped
--
-- The same four-part scope, and for the same reason 0097 records: seven
-- director bots share one Telegram chat id, so comparing the chat alone paired
-- a message sent to Claire with one typed into Tom's. Channel, chat,
-- addressed-to and subject — all four, or it leaks between agents.
--
-- ## Minutes, and few of them
--
-- A window, not a transcript. The cost is a prompt on a ~£0 budget, and an
-- hour of history is mostly irrelevant to "make it longer". Ninety minutes and
-- twelve turns is generous for a chat and cheap to carry.

begin;

create or replace function app.recent_exchange(
  p_command_id uuid,
  p_minutes    integer default 90,
  p_limit      integer default 12
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with self as (
    select * from public.inbound_commands where command_id = p_command_id
  ),
  -- What he said. Excludes button presses: a callback is an answer to a
  -- question, already recorded against it, and reading "useful" back as a
  -- conversational turn is noise.
  said as (
    select c.received_at as at,
           'grant'::text  as who,
           coalesce(c.transcript, c.instruction) as text
      from public.inbound_commands c, self
     where c.command_id <> self.command_id
       and c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = split_part(self.origin_ref, ':', 1)
       and coalesce(c.addressed_to, '') = coalesce(self.addressed_to, '')
       and coalesce(c.subject, c.actor) = coalesce(self.subject, self.actor)
       and c.callback_action is null
       and c.received_at < self.received_at
       and c.received_at >= self.received_at
             - make_interval(mins => greatest(coalesce(p_minutes, 90), 1))
       and coalesce(btrim(coalesce(c.transcript, c.instruction)), '') <> ''
  ),
  /*
    What went back to him.

    Joined through the job that answered each command rather than through the
    delivery, because a delivery row says a message was sent and not what was
    in it. `outputs.body` is the text, and it has no project_id — it joins
    through `jobs`, which is a trap already recorded in CLAUDE.md.
  */
  replied as (
    select o.created_at as at,
           coalesce(st.slug, 'the office') as who,
           o.body as text
      from self
      join public.inbound_commands c
        on c.origin_channel = self.origin_channel
       and split_part(c.origin_ref, ':', 1) = split_part(self.origin_ref, ':', 1)
       and coalesce(c.addressed_to, '') = coalesce(self.addressed_to, '')
      join public.jobs j
        on j.pinned_config ->> 'command_id' = c.command_id::text
      join public.outputs o
        on o.job_id = j.job_id
      left join public.staff st on st.staff_id = o.staff_id
     where o.created_at < self.received_at
       and o.created_at >= self.received_at
             - make_interval(mins => greatest(coalesce(p_minutes, 90), 1))
       and coalesce(btrim(o.body), '') <> ''
  ),
  turns as (
    select * from said
    union all
    select * from replied
  )
  select coalesce(jsonb_agg(t order by t.at), '[]'::jsonb)
    from (
      select at, who,
             -- Capped per turn. A 4,000-character answer three turns ago is
             -- not what "make it longer" refers to, and carrying it whole is
             -- how a context window becomes the cost of the feature.
             left(text, 600) as text
        from turns
       order by at desc
       limit greatest(coalesce(p_limit, 12), 1)
    ) t
$$;

comment on function app.recent_exchange(uuid, integer, integer) is
  'The last few turns in this chat, both sides, so a pronoun has an antecedent '
  '(#63). Scoped by channel, chat, addressed-to and subject — all four, '
  'because seven director bots share one chat id (0097).';

create or replace function public.recent_exchange(
  p_command_id uuid, p_minutes integer default 90, p_limit integer default 12
)
returns jsonb language sql stable security definer set search_path = ''
as $$ select app.recent_exchange(p_command_id, p_minutes, p_limit) $$;

commit;
