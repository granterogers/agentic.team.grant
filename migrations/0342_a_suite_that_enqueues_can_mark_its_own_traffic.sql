begin;

/**
 * A suite that goes through enqueue_inbound can mark its own traffic.
 *
 * Issue #203, and a finding rather than a request.
 *
 * ## What was actually happening
 *
 * `verify:addressing`'s own header says:
 *
 *     "Every job this writes is `requested_by` a `verify:` name, so
 *      `is_fixture` is generated true and no tally, briefing or health reading
 *      can see it."
 *
 * That is not true and has never been true. The suite sets a `dedupe_key` of
 * `verify:addressing:<run>`, but `requested_by` is not the dedupe key -
 * `enqueue_inbound` builds it as `<origin_channel>:<subject>`, which for that
 * suite is `voice:grant`.
 *
 * So the jobs were real. Measured before changing anything:
 *
 *     voice:grant  is_fixture=false  complete   43
 *     voice:grant  is_fixture=false  cancelled  27
 *
 * Forty-three of them ran. The office picked them up, spent tokens on them and
 * produced outputs, all attributed to Grant having said something on the voice
 * channel. They are in office_health, in the tallies, and in the briefings.
 *
 * It is also the cause of #203's intermittent failure: the suite asserts
 * `recipient_agent is null` immediately after enqueue, and a live worker
 * sometimes claims and runs the job first - correctly setting the column the
 * assertion expects to be empty. A race the suite could never win.
 *
 * CLAUDE.md's rule, again: a comment claiming a property is worth nothing
 * without a check behind it. 0317's header claimed idempotency for five
 * migrations while it was false; this one claimed fixture-ness for longer.
 *
 * ## Why the suite could not have got this right
 *
 * It is structural, not carelessness. `is_fixture` matched `verify:%`,
 * `verify`, `%-verification`, `gate-%`, `probe`, `purge:%`, or a kind of
 * `verification.%`. Through `enqueue_inbound`:
 *
 *   - `requested_by` is always `<origin_channel>:<something>`, and
 *     `origin_channel` is constrained to slack, telegram, voice and teamhq -
 *     so it can never begin `verify:`;
 *   - `kind` is hardcoded to `office.instruction`, so it can never begin
 *     `verification.`.
 *
 * **No suite driving the real enqueue path could produce a fixture job.** Which
 * means every suite that tests the thing Grant actually uses had to choose
 * between driving the real path and staying out of his numbers.
 *
 * ## The fix
 *
 * One more alternative: `%:verify-%`. A suite sets the command's `subject` to
 * `verify-<name>`, `enqueue_inbound` composes `voice:verify-addressing`, and
 * the job is a fixture while still travelling the identical code path.
 *
 * Deliberately `:verify-` rather than `%verify%`: a project genuinely called
 * "Verify" or an instruction mentioning the word must not silently become
 * harness traffic. The colon anchors it to the composed prefix, which nothing
 * but this construction produces.
 *
 * The existing 43 are NOT reclassified - `voice:grant` matches no new pattern,
 * and it should not. They really did run, they really did cost tokens, and
 * rewriting history to say otherwise is the denormalised-flag trap (0303) with
 * the sign reversed. They stay in the record as what they were.
 */

/*
  A generated column cannot be redefined in place, so this is a drop and add.
  Checked first: no index and no view depends on it - `pg_depend` over
  `pg_rewrite` returns nothing for this attribute - and the thirty-three
  functions that read it are plpgsql, which resolves names at run time.
*/
alter table public.jobs drop column is_fixture;

alter table public.jobs
  add column is_fixture boolean
  generated always as (
    coalesce(requested_by, '') like 'verify:%'
    or coalesce(requested_by, '') like 'verify'
    or coalesce(requested_by, '') like '%-verification'
    or coalesce(requested_by, '') like 'gate-%'
    or coalesce(requested_by, '') = 'probe'
    or coalesce(requested_by, '') like 'purge:%'
    -- 0342. A suite that goes through enqueue_inbound, where requested_by is
    -- composed as <origin_channel>:<subject> and can never start with verify:.
    or coalesce(requested_by, '') like '%:verify-%'
    or kind like 'verification.%'
  ) stored;

comment on column public.jobs.is_fixture is
  'Harness traffic, generated from requested_by and kind. Excluded from every '
  'tally, briefing and health reading, because test traffic reported as the '
  'office collapsing is a mistake this repository has already made. The '
  '%:verify-% alternative exists so a suite driving the REAL enqueue path can '
  'mark itself: enqueue_inbound composes requested_by as '
  '<origin_channel>:<subject> and origin_channel is constrained to four real '
  'surfaces, so without it no such suite could produce a fixture (0342, #203).';

commit;
