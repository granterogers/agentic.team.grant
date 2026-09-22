/*
  0546 — a preference one class of traffic taught may not retire another's

  ## What happened, within minutes of the mechanism existing

  #310 gave `remember()` the ability to supersede and to retract, both of
  which had existed in the database since they were written and neither of
  which had ever had a caller. The suite written to prove it ran once and

      "do not put screenshots in anymore"      (author: verify:preferences-…)

  retracted

      "From now on, always paste the image URLs into the reply as well …"
      (author: grant)

  one of the three standing instructions Grant actually has. The lookup asked
  `app.lessons_for`, which - correctly, since 0539 and 0545 - returns the REAL
  set and nothing else, so a harness-authored teaching was handed Grant's own
  rules as the things it might be talking about.

  Restored through `app.learn` rather than by deleting the retraction row: the
  retraction happened and the record should say so. Disabling an append-only
  trigger to tidy history is the thing this table exists to prevent.

  ## The property, which is not about testing

  A Shadow Grant session saying *"do not use bullets anymore"* against the
  deployed office would have done the same thing in production. Containment
  has always been one-directional here - 0539 and 0545 stop harness traffic
  REACHING a real prompt - and the moment a writer could retire a rule, it
  needed the other direction too: **harness traffic must not CHANGE real
  state.**

  ## Why a function rather than a copy of the predicate

  `lessons.is_fixture` is GENERATED and cannot be evaluated before the row
  exists, and the caller has to decide which candidates it may touch BEFORE
  writing anything. Restating the predicate in TypeScript would be the
  second-copy defect this repository records five times, so the predicate gets
  a name, and `verify:preferences` asserts the two agree on every row rather
  than trusting that they do.
*/

create or replace function app.harness_author(p_by text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select coalesce(p_by, '') like 'verify:%'
      or coalesce(p_by, '') like 'verify-%'
      or coalesce(p_by, '') = 'verify'
      or coalesce(p_by, '') like '%-verification'
      or coalesce(p_by, '') like 'gate-%'
      or coalesce(p_by, '') = 'probe'
      or coalesce(p_by, '') like 'purge:%'
$function$;

comment on function app.harness_author(text) is
  'Would a lesson written by this author be harness traffic? The same '
  'predicate lessons.is_fixture is GENERATED from, named so a caller can ask '
  'it BEFORE the row exists — which is what deciding whether a teaching may '
  'retire an existing rule requires. 0546: a suite-authored withdrawal '
  'retracted one of Grant''s three real standing instructions on its first '
  'run. verify:preferences asserts this agrees with is_fixture on every row.';

/*
  Driven, both ways, because reading a migration proves it parses.
*/
do $drive$
begin
  if not app.harness_author('verify:preferences-abc') then
    raise exception 'a suite author is not recognised as harness traffic';
  end if;
  if app.harness_author('grant') then
    raise exception 'Grant is being treated as harness traffic';
  end if;
  if app.harness_author('chief-of-staff') then
    raise exception 'an agent is being treated as harness traffic';
  end if;
  if exists (
    select 1 from public.lessons
     where is_fixture <> app.harness_author(learned_by)
  ) then
    raise exception 'the named predicate and the generated column disagree on an existing row';
  end if;
end
$drive$;
