import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  exportFilename,
  isStandardFormat,
  kindFor,
  type ProjectRecordsPayload,
  renderStandardExport,
} from '../../src/portability/export-route.ts'

const EXPORTED_AT = '2026-10-14T12:00:00.000Z'

const contact = {
  contact_id: '6f1c2b8e-0000-4000-8000-000000000001',
  kind: 'person',
  name: 'Priya Shah',
  role: '',
  org: '',
  stage: 'active',
  email: 'priya@example.test',
  phone: '',
  instagram: '',
  website: '',
  where: '',
  note: '',
  next: '',
  next_due: '',
  last_at: null,
  updated_at: '2026-10-01T09:30:00.000Z',
}

const task = {
  task_id: '11111111-0000-4000-8000-000000000002',
  title: 'Confirm the venue deposit',
  detail: '',
  state: 'todo',
  blocked_on: '',
  due_on: '2026-10-20',
  starts_on: null,
  priority: 100,
  is_milestone: false,
  parent_task_id: null,
  assigned_to_human: false,
  added_by: 'grant',
  created_at: '2026-10-01T09:00:00.000Z',
  updated_at: '2026-10-02T09:00:00.000Z',
  done_at: null,
}

const event = {
  calendar_id: 'agentic-team',
  event_id: 'evt-1',
  summary: 'Venue walk-through',
  excerpt: null,
  location: null,
  starts_at: '2026-10-12T21:00:00.000Z',
  ends_at: '2026-10-13T21:00:00.000Z',
  all_day: true,
  status: 'confirmed',
  html_link: null,
  remote_updated_at: null,
}

function payload(over: Partial<ProjectRecordsPayload> = {}): ProjectRecordsPayload {
  return {
    project: 'wellness-retreat',
    name: 'Wellness retreat',
    zone: 'Europe/Athens',
    records: [],
    ...over,
  }
}

describe('format choices', () => {
  it('reads one kind of record per format, so a request cannot mix them', () => {
    expect(kindFor('vcard')).toBe('contacts')
    expect(kindFor('ics')).toBe('events')
    expect(kindFor('csv')).toBe('tasks')
    expect(kindFor('json')).toBe('tasks')
  })

  it('refuses a format it does not know, and says so as a type guard', () => {
    expect(kindFor('pdf')).toBeNull()
    expect(isStandardFormat('pdf')).toBe(false)
    expect(isStandardFormat('vcard')).toBe(true)
  })
})

describe('exportFilename', () => {
  it('names the file from the project slug and a fixed stem', () => {
    expect(exportFilename('vcard', 'wellness-retreat')).toBe('wellness-retreat-contacts.vcf')
    expect(exportFilename('ics', 'wellness-retreat')).toBe('wellness-retreat-calendar.ics')
    expect(exportFilename('csv', 'wellness-retreat')).toBe('wellness-retreat-tasks.csv')
    expect(exportFilename('json', 'wellness-retreat')).toBe('wellness-retreat-tasks.json')
  })

  it('cannot carry a path or a header into the name', () => {
    const name = exportFilename('csv', '../../etc/passwd"; x')
    expect(name).not.toContain('/')
    expect(name).not.toContain('"')
    expect(name).not.toContain(';')
    expect(name.endsWith('-tasks.csv')).toBe(true)
  })

  it('falls back to a fixed word when nothing usable is left of the slug', () => {
    expect(exportFilename('vcard', '!!!')).toBe('project-contacts.vcf')
  })
})

describe('renderStandardExport', () => {
  it('writes contacts as vCards with the vCard content type', () => {
    const out = renderStandardExport('vcard', payload({ records: [contact] }), {
      exportedAt: EXPORTED_AT,
    })
    expect(out.contentType).toBe('text/vcard; charset=utf-8')
    expect(out.count).toBe(1)
    expect(out.filename).toBe('wellness-retreat-contacts.vcf')
    expect(out.body).toContain('BEGIN:VCARD')
    expect(out.body).toContain('FN:Priya Shah')
  })

  it('writes events as iCalendar, cutting all-day dates in the office zone', () => {
    const out = renderStandardExport('ics', payload({ records: [event] }), {
      exportedAt: EXPORTED_AT,
    })
    expect(out.contentType).toBe('text/calendar; charset=utf-8')
    // 21:00 UTC on the 12th is midnight on the 13th in Athens, so the zone decides the day.
    expect(out.body).toContain('DTSTART;VALUE=DATE:20261013')
  })

  it('falls back to UTC for events when the office has no zone, rather than failing', () => {
    const out = renderStandardExport('ics', payload({ zone: null, records: [event] }), {
      exportedAt: EXPORTED_AT,
    })
    expect(out.body).toContain('DTSTART;VALUE=DATE:20261012')
  })

  it('writes tasks as CSV and as a versioned JSON envelope naming the project', () => {
    const csv = renderStandardExport('csv', payload({ records: [task] }), {
      exportedAt: EXPORTED_AT,
    })
    expect(csv.body.split('\r\n')[0]).toContain('task_id,title')
    const json = renderStandardExport('json', payload({ records: [task] }), {
      exportedAt: EXPORTED_AT,
    })
    const parsed = JSON.parse(json.body)
    expect(parsed.format).toBe('agentic-team.tasks')
    expect(parsed.project).toBe('wellness-retreat')
    expect(parsed.count).toBe(1)
    expect(json.contentType).toBe('application/json; charset=utf-8')
  })

  it('writes a valid empty file for a project with nothing of that kind', () => {
    const out = renderStandardExport('vcard', payload({ records: [] }), { exportedAt: EXPORTED_AT })
    expect(out.count).toBe(0)
    expect(out.body).toBe('')
  })

  it('refuses an unknown format rather than guessing one', () => {
    expect(() => renderStandardExport('pdf', payload(), { exportedAt: EXPORTED_AT })).toThrow(
      /unknown export format/,
    )
  })

  it('refuses a payload whose records are not a list, so a broken answer is never written as a file', () => {
    const broken = {
      project: 'p',
      name: 'P',
      zone: null,
      records: 'oops',
    } as unknown as ProjectRecordsPayload
    expect(() => renderStandardExport('csv', broken, { exportedAt: EXPORTED_AT })).toThrow(
      /no record list/,
    )
  })
})

describe('the settings page offers exactly the formats the gateway serves', () => {
  const source = readFileSync(
    new URL('../../web/studio/project-settings.js', import.meta.url),
    'utf8',
  )

  function settingsFiles(): Record<string, string> {
    const body = /export const STANDARD_EXPORT_FILES = \{([\s\S]*?)\}/.exec(source)?.[1]
    if (body === undefined) throw new Error('STANDARD_EXPORT_FILES is not in project-settings.js')
    const out: Record<string, string> = {}
    for (const [, key, value] of body.matchAll(/(\w+):\s*'([^']+)'/g)) {
      if (key !== undefined && value !== undefined) out[key] = value
    }
    return out
  }

  it('lists the four formats and nothing else', () => {
    expect(Object.keys(settingsFiles()).sort()).toEqual(['csv', 'ics', 'json', 'vcard'])
  })

  it('names each file exactly as the server names it for the same project', () => {
    const files = settingsFiles()
    for (const format of Object.keys(files)) {
      const server = exportFilename(format as 'vcard', 'wellness-retreat')
      expect(`wellness-retreat-${files[format]}`).toBe(server)
    }
  })

  it('wires each button to the gateway section with the format it names', () => {
    // The request is built from the format the button carries, never from a fixed one.
    expect(source).toContain("readFile('project_standard_export', p.id, { format })")
    for (const format of ['vcard', 'ics', 'csv', 'json']) {
      expect(source).toContain(`data-stdexport="${format}"`)
    }
  })
})
