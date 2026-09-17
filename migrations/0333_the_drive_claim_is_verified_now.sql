begin;

/**
 * The Drive claim is verified now, and by a suite that actually runs it.
 *
 * Issue #96 and #51. 0332 corrected the wording of the `drive` capability row
 * and put `verified_by` back to `'declared'`, because 0300 had marked it
 * `'suite'` for code that did not exist. `verify:files` now drives the whole
 * chain — bytes into the private bucket, a document that keeps its connector
 * identity, the signed link the page is handed instead of the path, and
 * pdf.js reading back the exact words that were put in — so the row can say
 * `'suite'` and mean it.
 *
 * The distinction is the whole point of the column. `declared` is somebody's
 * word for it; `suite` is a thing that fails when the claim stops being true.
 * Moving between them is a migration rather than an edit, so the moment a
 * claim was proven is on the record beside the proof.
 *
 * `last_verified` is deliberately NOT set to now() in perpetuity — it is the
 * timestamp of this migration, and it will age. That is honest: a claim
 * verified six months ago and never since is a claim worth re-running, and a
 * column that always reads "just now" could never say so.
 */

update public.connector_capabilities
   set verified_by = 'suite',
       last_verified = app.now_utc()
 where connector = 'drive'
   and used_by = 'job kind drive.read_file';

commit;
