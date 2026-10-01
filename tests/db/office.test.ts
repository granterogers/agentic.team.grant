/**
 * The ways code with no request gets an office (src/db/office.ts). Every answer comes from the database and is minted
 * through `trustedOffice`, so a null, an empty row or a non-uuid is `no_office`, never a default.
 */
import { describe, expect, it } from 'vitest'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { namedOffice, officeOfJob, operatorOffice, soleOffice } from '../../src/db/office.ts'

const OFFICE = '11111111-1111-4111-8111-111111111111'

/** A database that answers every query with the given first-column value, and remembers what it was asked. */
const answering = (value: unknown, asked: string[] = []): SqlExecutor => ({
  kind: 'fake',
  execute: async (sql: string) => {
    asked.push(sql)
    return { rows: value === undefined ? [] : [{ o: value }] }
  },
})

describe('officeOfJob', () => {
  it('asks the database for the CLAIMED job and mints the answer', async () => {
    const asked: string[] = []
    const got = await officeOfJob(answering(OFFICE, asked), '22222222-2222-4222-8222-222222222222')
    expect(got).toBe(OFFICE)
    // The question names the job through the one function that answers it, not a column read off a payload.
    expect(asked[0]).toMatch(/app\.job_office\('22222222-2222-4222-8222-222222222222'::uuid\)/)
  })

  it('is no_office for a job the database does not know', async () => {
    await expect(
      officeOfJob(answering(null), '22222222-2222-4222-8222-222222222222'),
    ).rejects.toThrow('no_office')
    await expect(
      officeOfJob(answering(undefined), '22222222-2222-4222-8222-222222222222'),
    ).rejects.toThrow('no_office')
  })
})

describe('soleOffice', () => {
  it('is the deployment-wide answer of app.sole_person_office, and nothing else', async () => {
    const asked: string[] = []
    expect(await soleOffice(answering(OFFICE, asked))).toBe(OFFICE)
    expect(asked[0]).toMatch(/app\.sole_person_office\(\)/)
  })

  it('fails closed when there is more than one person office (the database answers NULL)', async () => {
    await expect(soleOffice(answering(null))).rejects.toThrow('no_office')
  })
})

describe('namedOffice and operatorOffice', () => {
  it('refuses a string that is not a uuid before it reaches SQL', async () => {
    const asked: string[] = []
    await expect(
      namedOffice(answering(OFFICE, asked), "x'; drop table public.jobs; --"),
    ).rejects.toThrow('no_office')
    expect(asked).toEqual([])
  })

  it('checks that a named office exists and is active', async () => {
    const asked: string[] = []
    expect(await namedOffice(answering(OFFICE, asked), OFFICE)).toBe(OFFICE)
    expect(asked[0]).toMatch(/o\.state = 'active'/)
    await expect(namedOffice(answering(undefined), OFFICE)).rejects.toThrow('no_office')
  })

  it('serves the named office when told one, the sole person office when not', async () => {
    const named: string[] = []
    await operatorOffice(answering(OFFICE, named), OFFICE)
    expect(named[0]).toMatch(/public\.offices/)
    const sole: string[] = []
    await operatorOffice(answering(OFFICE, sole))
    expect(sole[0]).toMatch(/sole_person_office/)
    const empty: string[] = []
    await operatorOffice(answering(OFFICE, empty), '')
    expect(empty[0]).toMatch(/sole_person_office/)
  })
})
