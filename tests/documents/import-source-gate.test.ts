import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
  The refusal itself is proved against a real database in scripts/isolated/import-source-gate.ts. These are the wired
  expressions that proof cannot see: the handler consumes the gate's answer, the migration splices every door a fetch can
  come through, and the page speaks a typed code instead of deciding. Each asserts a CALL whose answer is used, not a name.
*/
const read = (p: string): string => readFileSync(p, 'utf8')
const handler = read('src/handlers/drive-read.ts')
const migration = read('migrations/1010_a_new_import_needs_a_source_that_is_connected.sql')
const office = read('web/studio/office.js')
const view = read('web/studio/bc/docview.js')

describe('a new import of a disconnected source is refused by the server', () => {
  it('the drive.read_file handler asks the database before it spends a Drive request, and refuses on anything but ok', () => {
    const ask = handler.indexOf('app.document_import_gate(')
    const spend = handler.indexOf('driveAccess(deps.db')
    expect(ask).toBeGreaterThan(0)
    expect(spend).toBeGreaterThan(ask)
    expect(handler).toMatch(/if \(gate\?\.ok !== true\) \{\s*return failed\(/s)
    expect(handler).toMatch(/if \(!missing\)\s*return failed\(/)
  })

  it('only a database that does not have the function yet lets the read go on', () => {
    expect(handler).toMatch(/does not exist/)
    expect(handler).not.toMatch(/catch \{\s*\}/)
  })

  it('the migration splices the press, the enqueue and the fulfil, each asserted to have landed', () => {
    for (const fn of [
      'app.hq_document_import(uuid, uuid, text)',
      'app.document_import_enqueue_fetch(uuid, uuid)',
      'app.document_import_fulfil(uuid, uuid)',
    ]) {
      expect(migration).toContain(`pg_get_functiondef('${fn}'::regprocedure)`)
    }
    expect(migration.match(/did not land/g)?.length).toBe(3)
  })

  it('the refusal is typed, and the page and the gateway client keep the code', () => {
    expect(migration).toContain("'error_code', 'SOURCE_DISCONNECTED'")
    expect(office).toMatch(/refused\.code = body\.result\.error_code/)
    expect(view).toMatch(/e\?\.code === 'SOURCE_DISCONNECTED'/)
  })

  it('a document already imported is answered before the gate is asked', () => {
    const body = migration.slice(migration.indexOf('do $s$'))
    expect(body.indexOf('v_state := app.document_source_state(')).toBeGreaterThan(0)
    // the splice anchors on the instant-copy branch, which comes after the existing-copy branch in the live function
    expect(migration).toContain("'  if app.document_material_held(p_office, o.document_id) then'")
  })
})
