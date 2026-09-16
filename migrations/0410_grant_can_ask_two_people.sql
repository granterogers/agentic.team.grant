/*
  0410 - Grant can ask two people, not only one or nobody (#26).

  The specification asks for three ways to address the team:

      Ask one agent  ·  Ask selected agents  ·  Ask entire team

  Two of the three already worked. Addressing one person has worked since
  `inbound_commands.addressed_to` existed, and "ask entire team" is what
  happens when he names NOBODY: `pickRoster` reads the subject, convenes
  whoever the expertise columns say knows about it, and `alsoConvened` spawns
  a child job for each of them - which is also why the acceptance criterion
  "asking the whole team does not produce eight near-identical replies" is
  already met. Convening everyone with something to say is not the same as
  asking all eight, and the second would be worse.

  The missing one is the MIDDLE: Grant picking two or three himself.

  WHY A SECOND COLUMN RATHER THAN A LIST

  0311 spent a migration undoing two words for one thing, so a new column
  needs to say something the old one does not. These do:

    - `addressed_to`   is who ANSWERS. One person, a foreign key to staff, and
                       the thing `speaker()` returns as the voice of the reply.
    - `addressed_also` is who ELSE was asked. Each spawns a child job that
                       answers in its own name.

  That is exactly the `slug` / `alsoConvened` distinction the handler has had
  since #65, written down in the table rather than inferred. Collapsing them
  into one array would lose which of the three is speaking, and the answer
  Grant reads is one person's with the others beside it.

  WHY A TRIGGER AND NOT A FOREIGN KEY

  Postgres has no per-element foreign key for an array. The trigger does the
  same job and does it the way `say_in_project` already treats a bad
  addressee: an unknown or retired name is DROPPED and named in the result,
  never fatal. CLAUDE.md records why - a foreign key on a column an adapter
  writes turns a bad value into a lost message, and what Grant typed is gone
  because of who he addressed it to.
*/

alter table public.inbound_commands
  add column if not exists addressed_also text[] not null default '{}';

comment on column public.inbound_commands.addressed_also is
  'Who ELSE was asked. addressed_to answers; each of these answers in their own name. #26';

/*
  The elements are real, active people, and the answerer is not repeated among
  them - a person asked twice is one child job that duplicates the reply.
*/
create or replace function app.inbound_addressed_also_is_real()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_clean text[];
begin
  if new.addressed_also is null or cardinality(new.addressed_also) = 0 then
    new.addressed_also := '{}';
    return new;
  end if;

  select coalesce(array_agg(distinct s.slug order by s.slug), '{}')
    into v_clean
    from unnest(new.addressed_also) as t(slug)
    join public.staff s on s.slug = t.slug and s.active
   where new.addressed_to is null or s.slug <> new.addressed_to;

  new.addressed_also := v_clean;
  return new;
end;
$$;

drop trigger if exists inbound_addressed_also_is_real on public.inbound_commands;
create trigger inbound_addressed_also_is_real
  before insert or update of addressed_also, addressed_to on public.inbound_commands
  for each row execute function app.inbound_addressed_also_is_real();
