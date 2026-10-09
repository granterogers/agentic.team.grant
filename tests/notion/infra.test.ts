/*
  The database link versus the page. A connection that is timing out must END the sync and name itself; a statement the
  database refuses for one page's content must stay that page's problem, or a single bad page stops all the others.
  Both directions are asserted, because a classifier that says "link" about everything is as broken as one that says it
  about nothing.
*/
import { describe, expect, it } from 'vitest'
import { SqlExecutionError } from '../../src/db/executor.ts'
import { NotionApiError } from '../../src/notion/api.ts'
import { isDatabaseLinkFailure } from '../../src/notion/infra.ts'

const sql = (message: string, status: number | null = null) =>
  new SqlExecutionError(message, status)

describe('what is the database link', () => {
  it.each([
    [
      'postgres.js connect timeout (the edge worker)',
      'Failed to run sql query: write CONNECT_TIMEOUT db.host:5432',
    ],
    [
      'postgres.js closed connection',
      'Failed to run sql query: write CONNECTION_CLOSED db.host:5432',
    ],
    [
      'postgres.js destroyed connection',
      'Failed to run sql query: write CONNECTION_DESTROYED db.host:5432',
    ],
    ['a reset socket', 'Failed to run sql query: read ECONNRESET'],
    [
      'node-postgres, admin shutdown (57P01)',
      '57P01: terminating connection due to administrator command',
    ],
    ['node-postgres, connection exception class (08006)', '08006: connection failure'],
    ['the pooler is full', 'FATAL: sorry, too many clients already'],
    ['a statement timeout', '57014: canceling statement due to statement timeout'],
    ['a refused connection', 'connect ECONNREFUSED 127.0.0.1:5432'],
  ])('%s', (_name, message) => {
    expect(isDatabaseLinkFailure(sql(message))).toBe(true)
  })

  it('the Management API answering 429 or 5xx is the platform, not the statement', () => {
    expect(isDatabaseLinkFailure(sql('Too Many Requests', 429))).toBe(true)
    expect(isDatabaseLinkFailure(sql('Bad Gateway', 502))).toBe(true)
  })
})

describe('what is NOT the database link (one page stays one page)', () => {
  it.each([
    ['a NUL byte in text', '22021: invalid byte sequence for encoding "UTF8": 0x00'],
    [
      'a check constraint',
      '23514: new row for relation "documents" violates check constraint "documents_title_check"',
    ],
    ['a unique violation', '23505: duplicate key value violates unique constraint'],
    ['a plain refusal of ours', 'could not be filed: the page id is already in use'],
    ['a syntax error', '42601: syntax error at or near "left"'],
  ])('%s', (_name, message) => {
    expect(isDatabaseLinkFailure(sql(message))).toBe(false)
    expect(isDatabaseLinkFailure(new Error(message))).toBe(false)
  })

  it('a Management API 400 for a bad statement is not the link', () => {
    expect(isDatabaseLinkFailure(sql('Failed to run sql query: ERROR: 23514: x', 400))).toBe(false)
  })

  it('a Notion failure is never the database link, whatever its status', () => {
    expect(
      isDatabaseLinkFailure(
        new NotionApiError('internal_server_error', 'transient', '/x', 500, null),
      ),
    ).toBe(false)
    expect(isDatabaseLinkFailure(new NotionApiError('timeout', 'transient', '/x', 0, null))).toBe(
      false,
    )
  })

  it('anything that is not an error at all is not', () => {
    expect(isDatabaseLinkFailure(undefined)).toBe(false)
    expect(isDatabaseLinkFailure('CONNECT_TIMEOUT')).toBe(false)
    expect(isDatabaseLinkFailure(null)).toBe(false)
  })
})
