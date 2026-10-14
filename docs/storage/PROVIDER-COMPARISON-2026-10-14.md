# Storage provider comparison (Issue #468, Workstream B1)

**Verified:** 14 October 2026, by fetching each provider's official pricing page. Prices and allowances change; re-check before any decision that spends money.
**Scope:** object storage for project documents, attachments and archives. Not a decision to move any data. No production contact.

## Sources (official, fetched 14 Oct 2026)

- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Backblaze B2 pricing: https://www.backblaze.com/cloud-storage/pricing
- Supabase pricing: https://supabase.com/pricing
- Google Drive API usage limits: https://developers.google.com/workspace/drive/api/guides/limits

Not verified here: the Google Drive **personal storage** quota (15 GB is the figure in common use). The search did not confirm it against Google's storage page, so it is marked unverified below.

## Verified allowances and prices

| | Cloudflare R2 | Backblaze B2 | Supabase Storage | Google Drive |
|---|---|---|---|---|
| Free storage | 10 GB-month/month (Standard only) | first 10 GB always free | Free plan: 1 GB file storage | personal quota, **unverified** (15 GB commonly cited) |
| Free operations | 1 M Class A, 10 M Class B per month | Class A, B, C free (pay-as-you-go) | not stated on the page | API: 1,000,000 units/min per project, 325,000 per user per project |
| Storage price beyond free | $0.015 per GB-month | $6.95 per TB per month (≈ $0.00695/GB) | Pro: $0.0213/GB beyond 100 GB | not applicable (user's own quota) |
| Operation prices | Class A $4.50/M, Class B $0.36/M | Class D $0.004 per 10,000 (first 2,500/day free) | — | no charge today |
| Egress | **not charged** (Workers, S3 API, r2.dev) | free up to 3× average monthly storage, then $0.01/GB | Free plan 5 GB; Pro 250 GB included, then $0.09/GB | 1 TB/day per project; no charge today |
| Largest file | not on this page | not on this page | **Free plan: 50 MB per upload** | 5 TB per file |
| Charge after the free tier | yes, per the prices above | yes, per the prices above | Pro from $25/month (paid) | Google says quota overages are planned to incur charges "later in 2026" |

## Scenario costs (illustrative, monthly, from the verified prices)

Assumptions: one user; 500 writes and 2,000 reads a month; downloads of 5 GB, 25 GB and 100 GB a month, with egress not billed where the provider does not charge it. Figures are arithmetic on the prices above, not measurements.

| Stored | Cloudflare R2 | Backblaze B2 | Supabase Pro |
|---|---|---|---|
| 5 GB | **$0.00** (inside 10 GB free; ops inside free) | **$0.00** (inside 10 GB free; egress inside 3× allowance) | $25 (plan fee; free plan cannot hold 5 GB) |
| 25 GB | **≈ $0.23** (15 GB billable × $0.015) | **≈ $0.10** (15 GB billable × $6.95/TB) | $25 (inside 100 GB) |
| 100 GB | **≈ $1.35** (90 GB billable × $0.015) | **≈ $0.63** (90 GB billable; 100 GB egress inside 300 GB allowance) | $25 (inside 100 GB; egress inside 250 GB) |

At the 100 GB row the B2 egress allowance is 3 × 100 GB = 300 GB. If monthly downloads passed 300 GB, B2 would bill $0.01 per GB over that. R2 would bill none, which is why R2 is the robust choice when download volume is unknown.

## Assessment against the brief's criteria

- **Verified free capacity:** R2 gives 10 GB-month free; B2 gives 10 GB free; Supabase free gives 1 GB.
- **Egress:** R2 is unmetered for reads through its own APIs. This removes the variable that makes object storage costs hard to predict.
- **API compatibility:** R2 and B2 both expose S3-compatible APIs (not re-verified on the pricing pages). Supabase Storage has its own API.
- **Free-tier survival:** Supabase's free plan cannot hold a 5 GB estate and caps uploads at 50 MB, so Supabase Storage cannot be the free long-term store for documents. It is the current operational store and that stays as it is until a replacement is verified.
- **Google Drive:** good as a user-controlled backup destination, poor as the primary store. Its API charges are "planned later in 2026", which breaks the no-charge constraint for any heavy use.
- **Latency, multipart uploads, signed-URL details, file-size ceilings above the Supabase cap, backup and recovery features:** not verified on these pages. They are in B2's checklist and must be checked before a migration.

## Recommendation

**Primary object store: Cloudflare R2.** It is the lowest cost at 25 and 100 GB under these assumptions and its egress is not billed, so cost does not rise with downloads. The 10 GB free tier covers a small estate at no cost.

**Alternative: Backblaze B2**, if the lowest cost at scale matters more than unmetered downloads. Its egress allowance is generous but finite.

**Keep:** Supabase PostgreSQL remains the system of record for structured data. Supabase Storage stays the current file store until a replacement is verified.

**Optional backup:** Google Drive, user-controlled, not the primary store.

**Conditions before choosing R2:** confirm the S3 multipart and presigned-URL behaviour against Cloudflare's current docs; confirm the Class A and Class B rates match the operation counts the office will generate (measure, do not assume); and check that an R2 bucket can be private with signed access only (the brief requires no public URLs for private documents).

## What this does not decide

- No data is moved. Migration is #469 and needs an owner decision.
- No account is created and no paid plan is started. The Supabase Pro figures are shown for comparison only.
- The storage audit in the brief (database versus object growth, table sizes) is not done here. It needs read-only measurement under the production guard and owner authorisation.
