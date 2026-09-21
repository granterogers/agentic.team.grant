-- THE RECEIPT NOW CARRIES A VERDICT, AND THE SHAPE HAS TO KNOW.
--
-- `office.pursue` gained bounded re-planning and a deterministic goal
-- assessment (#283), so its receipt carries three things it did not have:
-- where the office got to, how many rounds it took, and what the goal still
-- wants. `output_shapes` validates the OPTIONAL keys as well as the required
-- ones, so a fact the shape has never heard of is refused -- which is exactly
-- how 0526 was found, with the job failing at the insert after every step had
-- already run.
--
-- `verdict` is REQUIRED, not optional, and that is the point of the change
-- rather than a detail of it. "All the steps ended" is not "the goal was met",
-- and a receipt that may omit which of those happened is a receipt that can be
-- read as success by default. Every plan that runs has an answer to the
-- question; the shape insists on it.
--
-- `rounds` and `unmet` are optional because a first-round success genuinely
-- has nothing to say about either.

insert into public.output_shapes (shape, description, required, optional)
values (
  'plan_carried_out',
  'What a constrained plan actually did, as receipts, and where it got to (#283). '
  || 'done and could_not name compiled steps; receipts are canonical ids the run '
  || 'produced; verdict is the deterministic assessment of the GOAL rather than of '
  || 'the steps.',
  jsonb_build_object(
    'goal', 'string',
    'steps', 'array<object>',
    'done', 'array<string>',
    'could_not', 'array<string>',
    'receipts', 'array<string>',
    'verdict', 'string'
  ),
  jsonb_build_object(
    'stopped_at', 'string',
    'rounds', 'number',
    'unmet', 'array<string>'
  )
)
on conflict (shape) do update
  set description = excluded.description,
      required = excluded.required,
      optional = excluded.optional;

-- DRIVE IT, both ways.
do $check$
declare v_problem text;
begin
  v_problem := app.output_shape_problem('plan_carried_out', jsonb_build_object(
    'goal', 'Review the handbook',
    'steps', jsonb_build_array(jsonb_build_object('id', 'look', 'capability', 'db.read')),
    'done', jsonb_build_array('look:db.read'),
    'could_not', jsonb_build_array(),
    'receipts', jsonb_build_array('00000000-0000-0000-0000-000000000000'),
    'verdict', 'satisfied',
    'rounds', 2,
    'unmet', jsonb_build_array()
  ));
  if v_problem is not null then
    raise exception 'a well-formed receipt with a verdict was refused: %', v_problem;
  end if;

  -- A receipt with no verdict must be REFUSED. Without this the change is a
  -- new optional key nobody has to supply, which is not what it is for.
  v_problem := app.output_shape_problem('plan_carried_out', jsonb_build_object(
    'goal', 'Review the handbook',
    'steps', jsonb_build_array(),
    'done', jsonb_build_array(),
    'could_not', jsonb_build_array(),
    'receipts', jsonb_build_array()
  ));
  if v_problem is null then
    raise exception 'a receipt with no verdict was accepted';
  end if;

  -- And rounds must be a number, so a handler cannot report "two" as prose.
  v_problem := app.output_shape_problem('plan_carried_out', jsonb_build_object(
    'goal', 'g', 'steps', jsonb_build_array(), 'done', jsonb_build_array(),
    'could_not', jsonb_build_array(), 'receipts', jsonb_build_array(),
    'verdict', 'satisfied', 'rounds', 'two'
  ));
  if v_problem is null then
    raise exception 'a rounds count given as prose was accepted';
  end if;
end $check$;
