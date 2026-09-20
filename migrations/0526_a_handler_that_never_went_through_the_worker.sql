-- A SHAPE THE OFFICE WAS PRODUCING AND THE SCHEMA HAD NEVER BEEN TOLD ABOUT.
--
-- `office.pursue` (#283) returns `shape = 'plan_carried_out'`. Nothing had ever
-- declared it, so `app.output_shape_problem` answered "not a declared output
-- shape", `outputs_match_their_shape` raised 23514, and the job FAILED at the
-- output insert -- after every step had already run and written its effects.
--
-- WHY NO SUITE SAW IT
--
-- `verify:pursues` calls `runSteps` directly, which is the right place to prove
-- that step B consumes step A's observation and is not the place Grant's work
-- goes through. The handler had never once been driven by the worker, so the
-- one line in it that talks to the schema had never executed. CLAUDE.md's
-- oldest standing warning, in a new costume: before trusting a green suite,
-- ask what it is pointed at. `verify:composes` enters where Grant enters and
-- found it on its first run.
--
-- WHAT THE SHAPE IS
--
-- Every field is a RECEIPT rather than a description. `done` and `could_not`
-- name steps by their compiled name, and `receipts` carries the canonical ids
-- the run actually produced -- which is what makes "created a task" checkable
-- against `public.tasks` instead of against prose.
--
-- `could_not` is required, not optional, and deliberately: a plan that could
-- not do something has to say so in the same breath as what it did. An
-- optional field is one a future handler forgets, and #60's rule is that a
-- report covering part of the work and presented as complete is worse than one
-- admitting it understood nothing.

insert into public.output_shapes (shape, description, required, optional)
values (
  'plan_carried_out',
  'What a constrained plan actually did, as receipts (#283). `done` and '
  || '`could_not` name compiled steps; `receipts` are canonical ids the run '
  || 'produced, so the narration can be checked against state rather than read.',
  jsonb_build_object(
    'goal', 'string',
    'steps', 'array<object>',
    'done', 'array<string>',
    'could_not', 'array<string>',
    'receipts', 'array<string>'
  ),
  jsonb_build_object('stopped_at', 'string')
)
on conflict (shape) do update
  set description = excluded.description,
      required = excluded.required,
      optional = excluded.optional;

-- DRIVE IT. A migration that applies cleanly is not a constraint that works,
-- and this one exists because something was declared and never exercised.
do $check$
declare v_problem text;
begin
  v_problem := app.output_shape_problem('plan_carried_out', jsonb_build_object(
    'goal', 'Review the handbook',
    'steps', jsonb_build_array(jsonb_build_object('id', 'look', 'capability', 'db.read')),
    'done', jsonb_build_array('look:db.read'),
    'could_not', jsonb_build_array(),
    'receipts', jsonb_build_array('00000000-0000-0000-0000-000000000000')
  ));
  if v_problem is not null then
    raise exception 'a well-formed plan receipt was refused: %', v_problem;
  end if;

  -- And it must still be able to REFUSE, or it is a check that cannot fail.
  v_problem := app.output_shape_problem('plan_carried_out', jsonb_build_object(
    'goal', 'Review the handbook',
    'steps', jsonb_build_array(),
    'done', jsonb_build_array()
  ));
  if v_problem is null then
    raise exception 'a receipt missing could_not and receipts was accepted';
  end if;

  -- A count is not a receipt. `receipts` has to be the ids themselves, so a
  -- handler cannot satisfy the shape by saying how many things it did.
  v_problem := app.output_shape_problem('plan_carried_out', jsonb_build_object(
    'goal', 'Review the handbook',
    'steps', jsonb_build_array(),
    'done', jsonb_build_array(),
    'could_not', jsonb_build_array(),
    'receipts', 3
  ));
  if v_problem is null then
    raise exception 'a number was accepted where the canonical ids belong';
  end if;
end $check$;
