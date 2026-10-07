/**
 * N1 - the delivery layer's contract with the database, driven through the real DeliveryService with a scripted
 * executor and a scripted transport (no network, no database). What the SQL does with these calls is proved on the
 * replica by `scripts/isolated/dl-delivery-redrive.ts`; this proves the calls are made, in order, with the right words.
 */
import { describe, expect, it, vi } from 'vitest'
import { DeliveryService, type Transport, TransportError } from '../../src/channels/delivery.ts'
import type { SqlExecutor } from '../../src/db/executor.ts'
import { redriveLapsedDeliveries } from '../../src/jobs/delivery-redrive.ts'
import { SlackClient } from '../../src/slack/api.ts'
import { SlackTransport } from '../../src/slack/transport.ts'
import { TelegramApiError, type TelegramClient } from '../../src/telegram/api.ts'
import { TelegramTransport } from '../../src/telegram/transport.ts'

const OFFICE = '11111111-1111-4111-8111-111111111111'
const request = {
  dedupeKey: 'job:abc:reply',
  accountRef: '1',
  targetRef: '1386648496',
  purpose: 'result' as const,
  correlationId: null,
  jobId: null,
  officeId: OFFICE,
  body: { text: 'hello' },
}

interface Script {
  claim?: { outcome: string; attempt?: number }
  begin?: string | Error
}
const executor = (script: Script = {}) => {
  const log: string[] = []
  const db = {
    execute: async (sql: string) => {
      log.push(sql)
      if (sql.includes('app.claim_delivery'))
        return {
          rows: [
            {
              delivery_id: 'd1',
              outcome: script.claim?.outcome ?? 'claimed',
              message_ref: null,
              attempt: script.claim?.attempt ?? 1,
            },
          ],
        }
      if (sql.includes('app.begin_delivery_send')) {
        if (script.begin instanceof Error) throw script.begin
        return { rows: [{ r: script.begin ?? 'go' }] }
      }
      if (sql.includes('app.record_delivery_sent')) return { rows: [{ outcome: 'sent' }] }
      return { rows: [{ outcome: 'x' }] }
    },
  } as unknown as SqlExecutor
  return { db, log }
}
const transportOf = (outcome: 'ok' | Error) => {
  const send = vi.fn(async () => {
    if (outcome !== 'ok') throw outcome
    return { messageRef: 'm1' }
  })
  return { transport: { channel: 'telegram', send } as unknown as Transport, send }
}
const idx = (log: string[], needle: string) => log.findIndex((s) => s.includes(needle))

describe('DeliveryService: the order is claim, intent, send, record', () => {
  it('records the intent to send BEFORE the transport is called, and the outcome after', async () => {
    const { db, log } = executor()
    const send = vi.fn(async () => {
      expect(idx(log, 'app.begin_delivery_send')).toBeGreaterThan(idx(log, 'app.claim_delivery'))
      return { messageRef: 'm1' }
    })
    const r = await new DeliveryService(db, { channel: 'telegram', send } as never).deliver(request)
    expect(r.outcome).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
    expect(idx(log, 'app.begin_delivery_send')).toBeLessThan(idx(log, 'app.record_delivery_sent'))
    expect(log[idx(log, 'app.begin_delivery_send')]).toContain('1) as r') // the attempt this claim returned
  })

  it('does not send when the fence says another attempt owns the row', async () => {
    const { db } = executor({ begin: 'fenced' })
    const { transport, send } = transportOf('ok')
    const r = await new DeliveryService(db, transport).deliver(request)
    expect(send).not.toHaveBeenCalled()
    expect(r.outcome).toBe('held')
  })

  it('does not send when the message is already recorded as sent', async () => {
    const { db } = executor({ begin: 'already_sent' })
    const { transport, send } = transportOf('ok')
    expect((await new DeliveryService(db, transport).deliver(request)).outcome).toBe('already_sent')
    expect(send).not.toHaveBeenCalled()
  })

  it('does not send a row that is terminal (the fence names it not_claimed)', async () => {
    const { db } = executor({ begin: 'not_claimed' })
    const { transport, send } = transportOf('ok')
    await new DeliveryService(db, transport).deliver(request)
    expect(send).not.toHaveBeenCalled()
  })

  it('still sends on a database built before the fence existed (that one error only)', async () => {
    const { db } = executor({
      begin: new Error(
        '42883: function app.begin_delivery_send(uuid, uuid, integer) does not exist',
      ),
    })
    const { transport, send } = transportOf('ok')
    expect((await new DeliveryService(db, transport).deliver(request)).outcome).toBe('sent')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does NOT swallow any other database error at the fence: the send is not made', async () => {
    const { db } = executor({ begin: new Error('57P01: terminating connection') })
    const { transport, send } = transportOf('ok')
    await expect(new DeliveryService(db, transport).deliver(request)).rejects.toThrow('terminating')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('DeliveryService: how each failure is recorded', () => {
  const failureSql = (log: string[]) =>
    log.find((s) => s.includes('app.record_delivery_failure')) ?? ''

  it('passes the provider Retry-After on a retryable failure (rounded up)', async () => {
    const { db, log } = executor()
    const { transport } = transportOf(new TransportError('rate_limited', 'retryable', 30.2))
    const r = await new DeliveryService(db, transport).deliver(request)
    expect(r.outcome).toBe('failed')
    expect(failureSql(log)).toContain("'rate_limited', true, 31)")
  })

  it('a retryable failure with no provider wait uses the four-argument call (older databases)', async () => {
    const { db, log } = executor()
    const { transport } = transportOf(new TransportError('http_500', 'retryable'))
    await new DeliveryService(db, transport).deliver(request)
    expect(failureSql(log)).toContain("'http_500', true)")
  })

  it.each([
    ['terminal', 'chat_not_found'],
    ['needs_human', 'blocked_by_user'],
  ] as const)('a %s failure is recorded as not retryable', async (kind, code) => {
    const { db, log } = executor()
    const { transport } = transportOf(new TransportError(code, kind, 99))
    await new DeliveryService(db, transport).deliver(request)
    expect(failureSql(log)).toContain(`'${code}', false)`)
  })

  it('an indeterminate failure (timeout, lost response) is parked, never marked retryable', async () => {
    const { db, log } = executor()
    const { transport } = transportOf(
      new TransportError('indeterminate:ETIMEDOUT', 'indeterminate'),
    )
    const r = await new DeliveryService(db, transport).deliver(request)
    expect(r.outcome).toBe('indeterminate')
    expect(failureSql(log)).toContain("'indeterminate:ETIMEDOUT', false)")
  })

  it('an unclassified throw is recorded as indeterminate (not left claimed) and then rethrown', async () => {
    const { db, log } = executor()
    const { transport } = transportOf(new Error('socket hang up'))
    await expect(new DeliveryService(db, transport).deliver(request)).rejects.toThrow(
      'socket hang up',
    )
    expect(failureSql(log)).toContain("'indeterminate:unclassified_error', false)")
  })
})

describe('the transports carry the provider wait through', () => {
  it('Telegram: retry_after on a 429 reaches the TransportError', async () => {
    const client = {
      call: vi.fn(async () => {
        throw new TelegramApiError('rate_limited', 'retryable', 'sendMessage', 31)
      }),
    } as unknown as TelegramClient
    const error = await new TelegramTransport(client)
      .send({
        targetRef: '1',
        threadRef: null,
        dedupeKey: 'k',
        correlationId: null,
        purpose: 'result',
        body: { text: 'x' },
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransportError)
    expect((error as TransportError).kind).toBe('retryable')
    expect((error as TransportError).retryAfterSeconds).toBe(31)
  })

  it('Slack: the Retry-After header on a 429 reaches the TransportError', async () => {
    const fetchImpl = (async () =>
      new Response('{}', {
        status: 429,
        headers: { 'retry-after': '45' },
      })) as unknown as typeof fetch
    const client = new SlackClient(['xoxb', 'FAKE', 'T'].join('-'), {
      fetchImpl,
      maxRateLimitRetries: 0,
      sleep: async () => undefined,
    })
    const error = await new SlackTransport(client)
      .send({
        targetRef: 'C0123456789',
        threadRef: null,
        dedupeKey: 'k',
        correlationId: null,
        purpose: 'result',
        body: { text: 'x', blocks: [] },
      })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransportError)
    expect((error as TransportError).kind).toBe('retryable')
    expect((error as TransportError).retryAfterSeconds).toBe(45)
  })
})

describe('the redrive', () => {
  const dbWith = (list: unknown[]) => {
    const log: string[] = []
    const db = {
      execute: async (sql: string) => {
        log.push(sql)
        if (sql.includes('settle_lapsed_deliveries'))
          return { rows: [{ s: { unconfirmed: 1, due: list.length } }] }
        if (sql.includes('deliveries_to_redrive')) return { rows: list }
        if (sql.includes('from public.outputs'))
          return {
            rows: [
              {
                body: 'Done.',
                confidence: 'medium',
                evidence: 'inferred',
                deterministic: true,
                model: null,
                sources: [],
                contradictions: null,
              },
            ],
          }
        return { rows: [] }
      },
    } as unknown as SqlExecutor
    return { db, log }
  }
  const due = {
    job_id: 'j1',
    output_id: 'o1',
    kind: 'office.pursue',
    correlation_id: 'c1',
    project_id: null,
  }

  it('settles first, then hands each due job and its stored output to the notifier', async () => {
    const { db, log } = dbWith([due])
    const notify = vi.fn(async () => ({ delivered: true, note: 'ok' }))
    const out = await redriveLapsedDeliveries(db, notify)
    expect(out.redriven).toBe(1)
    expect(out.settled).toMatchObject({ unconfirmed: 1 })
    expect(log.findIndex((s) => s.includes('settle_lapsed'))).toBeLessThan(
      log.findIndex((s) => s.includes('deliveries_to_redrive')),
    )
    const [job, output, outputId] = notify.mock.calls[0] as unknown as [
      { jobId: string },
      { body: string },
      string,
    ]
    expect(job.jobId).toBe('j1')
    expect(output.body).toBe('Done.')
    expect(outputId).toBe('o1')
  })

  it('with no notifier it settles and sends nothing', async () => {
    const { db } = dbWith([due])
    expect((await redriveLapsedDeliveries(db, undefined)).redriven).toBe(0)
  })

  it('a notifier that throws does not stop the next job and is not fatal', async () => {
    const { db } = dbWith([due, { ...due, job_id: 'j2' }])
    const notify = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ delivered: true, note: 'ok' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const out = await redriveLapsedDeliveries(db, notify)
    spy.mockRestore()
    expect(notify).toHaveBeenCalledTimes(2)
    expect(out.redriven).toBe(1)
  })

  it('is called by the drain, with the drain notifier, behind the recover switch (wiring, not a name)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/jobs/worker.ts', 'utf8')
    expect(src).toMatch(
      /if \(options\.recover !== false\) \{\s*await redriveLapsedDeliveries\(db, options\.notify\)/,
    )
  })
})
