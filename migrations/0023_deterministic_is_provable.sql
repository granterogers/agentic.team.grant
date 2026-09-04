-- 0023 — a deterministic output must be provably deterministic
--
-- §16, on the review exemption:
--
--   "the exemption must be defined by *how the answer was produced* -
--    deterministic code path vs. inference - because THAT IS CHECKABLE,
--    whereas 'was it important?' is not."
--
-- and, two paragraphs later:
--
--   "The gate cannot be bypassed by the caller."
--
-- 0018 built the gate correctly and then left those two sentences in tension.
-- `outputs.deterministic` is a plain boolean with `default false`, and the
-- review-gate trigger skips any output where it is true. Nothing checks it. An
-- agent writing `deterministic => true` on an inferred conclusion exempts its
-- own work from review, which is the caller bypass §16 rules out, reached
-- through the very field that was supposed to make the exemption checkable.
--
-- The property §16 names is checkable, and this file checks it. Two
-- independent facts contradict a claim of determinism:
--
--   1. The output records a `model`. A deterministic code path does not have
--      one. This is local to the row and cannot be evaded by timing.
--   2. The job that produced it has inference usage recorded against its
--      correlation id. §11 requires every inference attempt to be logged -
--      failures included - so an output from a job that called a model is not
--      from a deterministic path, whatever the row claims.
--
-- The second is the one that bites, and it is worth being clear about the
-- direction of the guarantee. It is not "no inference happened": a job can
-- have several outputs, some inferred and some genuinely mechanical. It is
-- narrower and still sufficient: an output cannot claim exemption from review
-- in a job whose work involved a model, because at that point the claim is no
-- longer checkable from the record - which is the standard §16 sets.
--
-- Erring toward review is deliberate. A mechanical output sent to review costs
-- a reviewer's attention; an inferred one that skips review is the failure the
-- whole section exists to prevent, and the two are not comparable.

begin;

create or replace function app.enforce_deterministic_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_correlation uuid;
  v_calls integer;
begin
  if not new.deterministic then
    return new;
  end if;

  if new.model is not null then
    raise exception
      'output % cannot be marked deterministic: it records model %. §16 defines '
      'the review exemption by HOW the answer was produced, and a deterministic '
      'code path does not have a model.', coalesce(new.output_id::text, '(new)'), new.model
      using errcode = 'check_violation';
  end if;

  select correlation_id into v_correlation from public.jobs where job_id = new.job_id;

  select count(*) into v_calls
  from public.inference_usage
  where correlation_id = v_correlation;

  if v_calls > 0 then
    raise exception
      'output cannot be marked deterministic: job % has % recorded inference '
      'attempt(s) against correlation %. §16 says the exemption must be defined '
      'by how the answer was produced because that is checkable - and the '
      'record says a model was called. Mark it deterministic only on a code '
      'path that makes no inference call, or send it to review.',
      new.job_id, v_calls, v_correlation
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app.enforce_deterministic_claim() is
  '§16: the review exemption is checkable, so it is checked. An output claiming '
  'a deterministic code path must not name a model, and must not come from a '
  'job with recorded inference usage.';

create trigger outputs_enforce_deterministic_claim
  before insert or update of deterministic, model on public.outputs
  for each row execute function app.enforce_deterministic_claim();

commit;
