# Database headroom: options for an owner decision (16 October 2026)

Status: options only. Nothing here has been changed in production, and no option is recommended over another until the
owner has chosen what the database is for.

## Measured

- Database size: 372.4 MB on 16 October 2026 (production, read only). The October audit measured 389 MB on 14 October.
  The two readings are not a growth rate: the database has been pruned by some duties in between, and two readings are
  not enough to project from.
- Free-tier database limit: 500 MB. The database is about 74% of it.
- Largest tables (total size, 16 October):
  - `public.jobs` 103.2 MB (heap 94.2 MB)
  - `public.job_state_transitions` 45.8 MB (heap 21.4 MB)
  - `public.events` 32.6 MB
  - `public.inference_usage` 23.8 MB
  - `public.document_chunks` 20.4 MB
  - `public.deliveries` 18.5 MB
  - `public.job_traces` 12.2 MB
  - `public.outputs` 8.5 MB

## What cannot be used

The brief forbids deleting audit history to free space. `job_state_transitions`, `events`, `jobs` and `deliveries` are the
office's own record of what it did, so they are not candidates for pruning.

## Options

1. **Archive old rows out of the database.** Move rows older than a cut-off into compressed files in Storage, keep the
   recent rows in the database, and keep a pointer so the history stays readable. Frees the most space and keeps the
   history. Costs: a read path for archived history, and a restore path that includes it. Storage is also a shared free
   allowance (1 GB), which the backups already use (see the retention run record).
2. **Rebuild derived data on demand.** `document_chunks` is derived from the documents, so it can be dropped and rebuilt
   from them. This frees about 20 MB with no loss of history. Costs: the rebuild time and any embedding cost on the way
   back; the rebuild must be tested before the drop.
3. **Shorten telemetry retention.** `inference_usage` and `job_traces` are telemetry rather than audit history. A shorter
   retention for them is a policy decision, which the owner would have to make. It is not a technical choice.
4. **Upgrade the database plan.** Removes the limit at a monthly price. This is a paid change and needs the owner's
   approval. The price must be checked on Supabase's current pricing page, which was not fetched for this document.

## What the owner needs to decide

- Which of options 1 to 4, or a combination.
- For option 3: how long telemetry is kept, and whether that retention is acceptable for the office's records.
- For option 4: whether a paid plan is acceptable.

Once one is chosen, the next steps are a design for that option, a proof on the replica, and a dry run before any
production change.
