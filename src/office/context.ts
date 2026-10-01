/**
 * The trusted office context (multi-user P3, wave 1).
 *
 * IDENTITY -> TRUSTED OFFICE CONTEXT -> RESOURCE CHECK. An `OfficeId` is a uuid that a TRUSTED component produced:
 * the gateway from a verified login, the worker from a claimed job's immutable office, a delegated child from its
 * parent. The brand exists so that a bare string out of a request body, a query string or a header cannot be passed
 * where an office is required without somebody writing the one function that mints it - and that function is here,
 * where it can be found and grepped.
 *
 * Holding an OfficeId is not authority over anything: the resolver that minted it is. A function that receives one
 * still checks the resource against it (`where id = $1 and office_id = $2`).
 */
declare const trusted: unique symbol

export type OfficeId = string & { readonly [trusted]: true }

export type OfficeContext = {
  readonly officeId: OfficeId
  /** `person`, `sample` or `test`. The system office is never a request's context. */
  readonly kind: 'person' | 'sample' | 'test'
  /** How it was established; recorded so an audit can tell a login from a claimed job. */
  readonly source: 'login' | 'job' | 'parent' | 'adapter'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mint an OfficeId from a value a trusted resolver returned. Refuses anything that is not a uuid. */
export const trustedOffice = (resolved: unknown): OfficeId => {
  if (typeof resolved !== 'string' || !UUID.test(resolved)) throw new Error('no_office')
  return resolved as OfficeId
}

/** The arguments a function takes when the caller supplied an office: there are none. These are discarded. */
export const CALLER_OFFICE_KEYS = ['p_office', 'office_id', 'owner_key', 'x-office-id'] as const
