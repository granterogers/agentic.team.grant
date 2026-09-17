begin;

-- ---------------------------------------------------------------------------
-- 0395 - the numbers in 0394's header were harness traffic (#127)
--
-- 0394 is correct and stays. Its HEADER is not, and an applied migration
-- cannot be edited, so the correction goes here - where the next person
-- reading the comment on the view will find it.
--
-- 0394's header argued for itself with these figures:
--
--     office.instruction | dots-3-note-preview:free |  211 tried |  17% good
--     office.instruction | ling-3.0-flash-fin:free  |  174 tried |  30% good
--     office.instruction | qwen3.7-flash            |   23 tried |   0% good
--
-- and concluded that "four hundred calls on the office's MAIN job kind went to
-- models that fail it four times in five". **That is not true.** Those are raw
-- `inference_usage` rows. The view 0394 actually created excludes harness
-- traffic through `app.harness_job`, and once it does, the same three rows are:
--
--     office.instruction | dots-3-note-preview:free |    9 tried |  78% good
--     office.instruction | ling-3.0-flash-fin:free  |    - no real calls at all
--     office.instruction | qwen3.7-flash            |    - no real calls at all
--
-- 204 of those 213 calls were the certification and QA runs. On REAL traffic
-- the whole picture is 105 calls at 91% (north-mini-code), 12 at 92%
-- (gpt-oss-120b) and 9 at 78% (dots-3). Nothing is failing four times in five,
-- nothing meets the twenty-call floor, and `app.model_order` therefore demotes
-- NOTHING today. That is the mechanism working, not the mechanism idle.
--
-- This is the fifth time in this repository that harness traffic was about to
-- be reported as the office failing, and the first time it happened INSIDE a
-- feature built to measure the office - which is the worst place for it,
-- because a measurement that cries wolf is one Grant learns to ignore. The
-- file header was written from a query run before the filter existed and was
-- never re-run against the thing that shipped. **Re-read your own evidence
-- through the filter you just built.**
--
-- ## What is actually worth knowing, now that the number is honest
--
-- 1,700 of roughly 1,860 attributable calls land under `(unattributed)` -
-- they carry no `job_id`, so they can never inform any kind's record. The
-- `jobId` field on `CompletionRequest` exists precisely for this and most
-- callers outside the worker do not pass it. The per-kind record will stay
-- thin until they do, and that is a coverage gap rather than a defect in the
-- measurement. Filed rather than fixed here.
-- ---------------------------------------------------------------------------

comment on view public.model_record is
  'What each model has actually done, per kind of work (#127, 0394; corrected '
  '0395). Derived from inference_usage joined to jobs - there is no stored '
  'copy, because a copy is the thing that rots. Only outcomes the MODEL is '
  'answerable for are counted: ok, empty_completion, malformed_response. A '
  'rate limit or an outage is the provider failing, not the model being bad. '
  'HARNESS TRAFFIC IS EXCLUDED, so the counts here are much smaller than raw '
  'inference_usage - 0394''s own header quoted the raw numbers and was wrong '
  'about the office by a factor of twenty. Most calls carry no job_id and land '
  'under the kind (unattributed); they can never inform a real kind''s record.';

commit;
