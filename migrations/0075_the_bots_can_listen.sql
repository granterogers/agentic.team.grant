-- 0075 — The bots can listen
--
-- Grant: *"the Telegram bots need to be able to receive voice notes. So when I
-- send a voice note, it's automatically understood, transcribed or whatever. I
-- don't need to see the transcription, but the receiving bots need to obviously
-- be able to work on that."*
--
-- Two requirements, and the second is the load-bearing one. The transcript is
-- not something to show him; it is the instruction. So it is stored — Postgres
-- is canonical and a spoken command whose words nobody can read afterwards is a
-- command that cannot be audited — and then it is acted on. Grant sees the
-- answer.
--
-- ## Why the command can now be empty
--
-- `app.enqueue_inbound` refused a command with no instruction, and rightly:
-- until today an empty instruction meant a sticker. A voice note is the first
-- thing that is genuinely a command and genuinely has no text yet, so the rule
-- becomes "text OR a recording" rather than being dropped.
--
-- The transcription itself is not done here and not in the webhook. It needs a
-- model, a temp file and a bot token; the Edge Function has none of those and
-- the database has fewer. The worker does it, which is also the only place
-- where taking thirty seconds over it is free.

begin;

alter table public.inbound_commands
  add column voice_file_id text,
  add column voice_seconds integer,
  add column transcript    text;

comment on column public.inbound_commands.voice_file_id is
  'Telegram''s handle for the recording, when the instruction was spoken. The '
  'handle, not the audio: we never store Grant''s voice, only the words.';
comment on column public.inbound_commands.transcript is
  'What the recording said, filled in by the worker. Not shown to Grant - he '
  'asked not to see it - but stored, because an instruction nobody can read '
  'afterwards is an instruction that cannot be audited.';

-- A command must carry SOMETHING. Empty text and no recording is a sticker.
alter table public.inbound_commands
  add constraint inbound_commands_says_something
    check (
      callback_action is not null
      or coalesce(trim(instruction), '') <> ''
      or voice_file_id is not null
    );

create or replace function app.enqueue_inbound(p_command_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  c record;
  v_project uuid;
  v_job uuid;
begin
  select * into c from public.inbound_commands where command_id = p_command_id;
  if not found then
    return jsonb_build_object('error', 'no such command');
  end if;
  if c.job_id is not null then
    -- Already turned into work. Idempotent because a webhook is at-least-once
    -- and the same instruction arriving twice must not be done twice.
    return jsonb_build_object('job_id', c.job_id, 'already', true);
  end if;
  -- 0075: a recording is an instruction whose words have not been read yet.
  if coalesce(trim(c.instruction), '') = '' and c.voice_file_id is null then
    return jsonb_build_object('error', 'nothing to do: the command carries no instruction');
  end if;

  select project_id into v_project
    from public.projects where status = 'active'
   order by updated_at desc
   limit 1;

  if v_project is null then
    return jsonb_build_object('error', 'no active project to attach this to');
  end if;

  insert into public.jobs
    (correlation_id, project_id, idempotency_key, kind, requested_by, priority, pinned_config)
  values (gen_random_uuid(), v_project,
          format('inbound-%s', p_command_id),
          'office.instruction',
          format('%s:%s', c.origin_channel, coalesce(c.subject, c.actor)),
          150,
          jsonb_build_object(
            'instruction', c.instruction,
            'addressed_to', c.addressed_to,
            'origin_channel', c.origin_channel,
            'origin_ref', c.origin_ref,
            'command_id', p_command_id,
            'voice_file_id', c.voice_file_id,
            'voice_seconds', c.voice_seconds
          ))
  returning job_id into v_job;

  update public.inbound_commands
     set job_id = v_job, processed_at = app.now_utc()
   where command_id = p_command_id;

  return jsonb_build_object('job_id', v_job, 'already', false, 'spoken', c.voice_file_id is not null);
end;
$$;

commit;
