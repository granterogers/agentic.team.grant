/**
 * Getting an office for code that has no request (multi-user P3, inline SQL).
 *
 * A worker handler holds a CLAIMED job, and the job's office is fixed when the job is made, so it is the one office a
 * handler may act in. A deployment duty that is not given one resolves it here, from the database, never from a
 * payload, a request or a model answer.
 *
 * Nothing in this file accepts an office from outside: every function asks the database and mints the answer
 * through `trustedOffice`, which refuses anything that is not a uuid.
 */
import { type OfficeId, trustedOffice } from '../office/context.ts'
import type { SqlExecutor } from './executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The office of a claimed job. `app.job_office` raises `no_office` for a job that does not exist and for a disabled
 * office, so a handler for a job that has vanished fails closed instead of acting nowhere in particular.
 */
export const officeOfJob = async (db: SqlExecutor, jobId: string): Promise<OfficeId> =>
  trustedOffice(
    (await db.execute(`select app.job_office(${lit(jobId)}::uuid)::text as o`)).rows[0]?.o,
  )

/**
 * The deployment's only person office, for a single-office deployment's operator tools and legacy callers that have
 * no job to ask. `app.sole_person_office()` answers NULL the moment a second real office or a sample exists, and
 * `trustedOffice` turns NULL into `no_office`: this keeps working while there is one person and refuses to guess
 * once there are two. It is the compatibility bridge's own rule, asked out loud rather than applied silently.
 */
export const soleOffice = async (db: SqlExecutor): Promise<OfficeId> =>
  trustedOffice((await db.execute(`select app.sole_person_office()::text as o`)).rows[0]?.o)

/**
 * A named office, checked to exist and be active. For an operator who says which office a tool serves
 * (`OFFICE_ID=...`); an id that names nothing is `no_office`, the same answer as no id at all.
 */
export const namedOffice = async (db: SqlExecutor, officeId: string): Promise<OfficeId> =>
  trustedOffice(
    (
      await db.execute(
        `select o.office_id::text as o from public.offices o
          where o.office_id = ${lit(trustedOffice(officeId))}::uuid and o.state = 'active'`,
      )
    ).rows[0]?.o,
  )

/**
 * The office an operator tool serves: the one it was told (`OFFICE_ID`), else the sole person office. Scripts read the
 * environment and pass the value in; library code never reads it.
 */
export const operatorOffice = async (db: SqlExecutor, named?: string): Promise<OfficeId> =>
  named === undefined || named === '' ? soleOffice(db) : namedOffice(db, named)
