import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  #392.3: the Slack door binds an event and a button press to the installed workspace, except inside a declared test
  conversation. Asserted as the WIRED condition in the source (comments stripped), and as order: the workspace is asked
  after admission and before anything is stored.
*/
const src = readFileSync(
  new URL('../../supabase/functions/slack-events/index.ts', import.meta.url),
  'utf8',
)
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
describe('the Slack door asks which workspace', () => {
  it('asks the database function, not a list in the edge function', () => {
    expect(code).toMatch(/rest\/v1\/rpc\/slack_team_ok/)
  })
  it('for events: after admission, only when not a declared test, before the command is stored', () => {
    const ev = code.slice(code.indexOf('const sender = await admission('))
    const ask = ev.indexOf("if (sender !== 'test') {")
    const store = ev.indexOf('await storeCommand(command)')
    expect(ask).toBeGreaterThan(0)
    expect(store).toBeGreaterThan(ask)
    expect(ev.slice(ask, store)).toMatch(/w === 'wrong'/)
    expect(ev.slice(ask, store)).toMatch(/w === 'unknown'/)
  })
  it('for button presses: the same condition before the press is stored', () => {
    const pr = code.slice(code.indexOf('const presser = await admission('))
    const ask = pr.indexOf("if (presser !== 'test') {")
    const store = pr.indexOf('await storeCommand(pressed)')
    expect(ask).toBeGreaterThan(0)
    expect(store).toBeGreaterThan(ask)
    expect(pr.slice(ask, store)).toMatch(/w === 'wrong'/)
  })
  it('a failure to ask is a 503, never a yes', () => {
    expect((code.match(/could not check the workspace/g) ?? []).length).toBe(2)
  })
})
