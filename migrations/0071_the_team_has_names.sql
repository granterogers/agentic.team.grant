-- 0071 — the team has names
--
-- Grant: *"the point is to make this look as close as possible to humans. […]
-- You said you'd give them names and avatars, all this kind of stuff. So go
-- ahead and do that."*
--
-- The schema has had `name` and `title` as separate columns since 0018, which
-- was the right shape and was then filled in wrongly: every `name` was a copy
-- of the `title`. So the office introduced people as "Research Director ·
-- Research Director", which reads like a form field rather than a colleague.
--
-- Now: `name` is the person, `title` is the job. The photorealistic avatars
-- already exist and are keyed by slug, so they need no change — the faces were
-- always there and had nobody attached to them.
--
-- ## Why names in a migration rather than a config file
--
-- Grant's larger goal is that *"theoretically I could give the repo to somebody
-- else and they could run it for their own projects"* — so nothing about his
-- team may be baked into code. A row is editable from the front end; a constant
-- in TypeScript is a fork. These are seeds, not definitions.
--
-- The names themselves are a judgement call I am making rather than asking
-- about, because eight arbitrary names are quicker to change than to choose by
-- correspondence. They are deliberately varied and deliberately not famous:
-- a colleague called after a celebrity is a joke that stops being funny on the
-- second day.

begin;

update public.staff set name = 'Mara Ellis'      where slug = 'chief-of-staff';
update public.staff set name = 'Ines Okonkwo'    where slug = 'research-director';
update public.staff set name = 'Tom Ravel'       where slug = 'strategy-director';
update public.staff set name = 'Priya Raman'     where slug = 'growth-director';
update public.staff set name = 'Daniel Kessler'  where slug = 'finance-director';
update public.staff set name = 'Sofia Marchetti' where slug = 'operations-director';
update public.staff set name = 'Hana Sato'       where slug = 'quality-director';
update public.staff set name = 'Elias Bramwell'  where slug = 'communications-director';

-- The titles were already right; restated so a reader of this file sees the
-- pairing rather than having to join two places in their head.
update public.staff set title = 'Chief of Staff'                       where slug = 'chief-of-staff';
update public.staff set title = 'Research Director'                    where slug = 'research-director';
update public.staff set title = 'Strategy Director'                    where slug = 'strategy-director';
update public.staff set title = 'Growth & Marketing Director'          where slug = 'growth-director';
update public.staff set title = 'Finance & Data Director'              where slug = 'finance-director';
update public.staff set title = 'Operations Director'                  where slug = 'operations-director';
update public.staff set title = 'Quality & Risk Director'              where slug = 'quality-director';
update public.staff set title = 'Communications & Creative Director'   where slug = 'communications-director';

-- A name is a person's, not a role's: two staff sharing one is a bug in the
-- seeding, and the office would present two different people identically.
create unique index staff_names_are_distinct on public.staff (lower(name)) where active;

comment on column public.staff.name is
  'The person''s name, editable from the front end. Distinct from `title`, '
  'which is the job. Both were the job until 0071, so the office introduced '
  'people as "Research Director · Research Director".';

-- --------------------------------------------------------------------------
-- Channel debris
-- --------------------------------------------------------------------------
--
-- Grant: *"remove any extraneous channels. Any channels will be created by the
-- Chief of Staff according to need."*
--
-- Three of the five live mappings are verification fixtures whose suites were
-- interrupted before their cleanup ran. Marked inactive here; the Slack side is
-- archived by `npm run slack:rename-channels`, which already reconciles against
-- Slack because Slack is the authority on archived.

update public.slack_channel_map m
   set active = false, archived_at = coalesce(archived_at, app.now_utc())
 where m.active
   and (m.channel_name like 'chaos-%'
        or m.channel_name like '%verification-fixture%'
        or m.channel_name like 'proj-fixture-%');

commit;
