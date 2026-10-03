/**
 * The Sample Person: the one canonical authenticated test person for development, UX testing and browser acceptance.
 *
 * It is NOT a demo mode. It is the existing P4 second person - a real auth user with its own office (office_id), served by
 * the same gateway, worker and handlers as Grant - reused rather than replaced, so there is exactly one such account.
 * Its login password lives in the Vault (`p4.second_person.password`); nothing here prints or stores a credential.
 *
 * Every command that writes to the Sample office resolves the office from the LOGIN (auth email -> offices row) and then
 * refuses unless the office is structurally not Grant's: it must not be the operator office, not the system or test
 * office, and its owner key must be the Sample's. Nothing here is decided by typing a name.
 */
import { act, db, ENDPOINT, read, type Session, secondSession } from '../p4/lib.ts'
import { SECOND_EMAIL } from '../p4/provision-second-person.ts'
import { guardOffice, SAMPLE_OWNER_KEY } from './guard.ts'

export const SAMPLE_EMAIL = SECOND_EMAIL
export { guardOffice, SAMPLE_OWNER_KEY }
/** The persona the baseline content is written for. Fictional, and unlike any of Grant's work so a leak is unmistakable. */
export const PERSONA = { name: 'Jordan Reyes', business: 'Brightside Café' }

const rows = async (sql: string): Promise<Record<string, unknown>[]> =>
  (await db.execute(sql)).rows as Record<string, unknown>[]

export type SampleOffice = { officeId: string; authUserId: string }

/**
 * The Sample office, proven. Throws unless every structural condition holds, so a command that is handed the wrong office
 * (or run when Grant's office somehow answers to this login) does nothing at all.
 */
export const sampleOffice = async (): Promise<SampleOffice> => {
  const r = (
    await rows(`
      select o.office_id::text as office, o.auth_user_id::text as auth, o.kind, o.state,
             (o.office_id = app.operator_office()) as is_operator,
             (select m.owner_key from public.office_members m where lower(m.email) = lower(u.email) limit 1) as owner_key
        from auth.users u join public.offices o on o.auth_user_id = u.id
       where lower(u.email) = lower('${SAMPLE_EMAIL}')`)
  )[0]
  if (r === undefined)
    throw new Error('the Sample Person has no office (run provision-second-person --go)')
  guardOffice(String(r.office), {
    isOperator: r.is_operator === true,
    kind: String(r.kind),
    ownerKey: String(r.owner_key),
    state: String(r.state),
  })
  return { officeId: String(r.office), authUserId: String(r.auth) }
}

export const session = (): Promise<Session> => secondSession()

export const gateway = (s: Session) => ({
  act: (action: string, args: Record<string, unknown> = {}) => act(s.access_token, action, args),
  read: (section: string, extra = '') => read(s.access_token, section, extra),
})

export const result = (r: { json: unknown }): Record<string, unknown> =>
  ((r.json as { result?: Record<string, unknown> } | null)?.result ?? {}) as Record<string, unknown>

export { db, ENDPOINT, rows }
export const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
