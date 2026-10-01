/**
 * Whose rows a reader of what a model is shown may read (multi-user P3, cluster g-context).
 *
 * Every retrieval, memory and capability reader is asked of ONE office, and the office is never an ambient default:
 * a worker handler names the CLAIMED job (`{ jobId }`, resolved in SQL by `app.job_office`, which raises rather than
 * guess), and a script or a suite that holds no job names the office it is working in (`{ officeId }`). Neither is ever
 * a value taken from a request or from a model's output.
 */

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export type RetrievalOffice = { readonly jobId: string } | { readonly officeId: string }

/** The SQL expression for the office. */
export const officeOf = (office: RetrievalOffice): string =>
  'jobId' in office ? `app.job_office(${lit(office.jobId)}::uuid)` : `${lit(office.officeId)}::uuid`
