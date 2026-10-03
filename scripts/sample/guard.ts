/**
 * The rule that decides whether an office may be treated as the Sample Person's. Pure: no database, no import that
 * reaches one, so a unit test can aim it at Grant's office and watch it refuse.
 *
 * Decided by structure, never by a name typed by whoever runs the command: the operator's office is refused first, then
 * anything that is not a person office, then any owner key other than the Sample's, then a disabled office.
 */
export const SAMPLE_OWNER_KEY = 'p4-second-person'

export type OfficeFacts = { isOperator: boolean; kind: string; ownerKey: string; state: string }

export const guardOffice = (officeId: string, f: OfficeFacts): void => {
  if (f.isOperator)
    throw new Error(`REFUSED: ${officeId} is the operator's office, not the Sample Person's`)
  if (f.kind !== 'person' && f.kind !== 'sample')
    throw new Error(`REFUSED: ${officeId} is a ${f.kind} office, not a person's`)
  if (f.ownerKey !== SAMPLE_OWNER_KEY)
    throw new Error(`REFUSED: ${officeId} belongs to "${f.ownerKey}", not the Sample Person`)
  if (f.state !== 'active') throw new Error(`REFUSED: ${officeId} is ${f.state}`)
}
