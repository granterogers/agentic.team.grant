-- 0652 - no member is Grant by default (multi-user P1, #400, threat E18).
--
-- public.office_members.owner_key defaulted to 'grant'. A row inserted with only an email therefore became
-- {kind person, owner_key grant}: it spoke as Grant on voice and Telegram, decided his approvals, and - since 0647 -
-- was an OPERATOR, because public.deployment_operator asks whether the owner key 'grant' is a person member. Adding a
-- second human by the obvious one-line insert would have made them the first one. Nothing else in the schema has to
-- be wrong for that to be true.
--
-- This removes the ambient identity and fences the namespace:
--   * owner_key has no default: a member is added WITH the key they will speak as, or not at all;
--   * a key has a shape (lower-case letters, digits, hyphen and underscore) - no spaces, no ':' - because the key is
--     spliced into requested_by as '<channel>:<subject>' and a colon there is a second field;
--   * a PERSON's key may not be a name the office already treats as something else: the reserved words, or a harness
--     prefix (app.principal_kind reads a harness NAME as harness whatever row lists it, so a person called
--     'verify-sam' would be a test principal);
--   * one person per key: two members cannot share an identity, which is the other way to be somebody else.
--
-- kind keeps its default ('person'): the failure that matters is an UNNAMED identity, and every existing writer
-- already says who it is adding.

alter table public.office_members alter column owner_key drop default;

alter table public.office_members
  add constraint office_members_owner_key_shape
  check (owner_key ~ '^[a-z][a-z0-9_-]{1,40}$');

alter table public.office_members
  add constraint office_members_person_key_not_reserved
  check (
    kind <> 'person'
    or (owner_key not in ('office', 'hq', 'system', 'mcp', 'unnamed', 'chief-of-staff', 'the-office')
        and owner_key !~ '^(verify|fixture|probe|gate|ledger-proof|phase)-')
  );

create unique index if not exists office_members_one_person_per_key
  on public.office_members (owner_key) where kind = 'person';

comment on column public.office_members.owner_key is
  'The key this member speaks and acts as. No default (0652): a member is added with the key they will use. Shape and reserved words are checked; one person per key.';

-- ROLLBACK (not part of the migration): alter table public.office_members alter column owner_key set default 'grant'
-- (do not, unless every writer is known to name its key); drop the two constraints and the index.
