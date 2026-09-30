import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  B13 of the original audit: the Slack door called enqueue_inbound before it wrote inbound_commands_slack, so a worker
  that dequeued the turn in the gap could find a job with no routing. Asserted as ORDER of the two calls in the source
  of the one place that stores a command, comments stripped.
*/
const src = readFileSync(
  new URL('../../supabase/functions/slack-events/index.ts', import.meta.url),
  'utf8',
)
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
describe('the Slack door writes the routing before it enqueues the turn', () => {
  const route = code.indexOf("rest('inbound_commands_slack'")
  const enqueue = code.indexOf("rest('rpc/enqueue_inbound'")
  it('has both calls', () => {
    expect(route).toBeGreaterThan(0)
    expect(enqueue).toBeGreaterThan(0)
  })
  it('routes first', () => {
    expect(route).toBeLessThan(enqueue)
  })
  it('and enqueues exactly once', () => {
    expect((code.match(/rpc\/enqueue_inbound/g) ?? []).length).toBe(1)
  })
})
