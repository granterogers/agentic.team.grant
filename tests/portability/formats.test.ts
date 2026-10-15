import { describe, expect, it } from 'vitest'
import {
  type CalendarRecord,
  type ContactRecord,
  contactsToVcard,
  csvCell,
  dateBasicIn,
  escapeText,
  eventsToIcal,
  foldLine,
  TASK_CSV_COLUMNS,
  type TaskRecord,
  tasksToCsv,
  toJsonExport,
  utcBasic,
} from '../../src/portability/formats.ts'

const CONTACT_ID = '6f1c2b8e-0000-4000-8000-000000000001'

function contact(over: Partial<ContactRecord> = {}): ContactRecord {
  return {
    contact_id: CONTACT_ID,
    kind: 'person',
    name: 'Priya Shah',
    role: '',
    org: '',
    stage: 'active',
    email: '',
    phone: '',
    instagram: '',
    website: '',
    where: '',
    note: '',
    next: '',
    next_due: '',
    last_at: null,
    updated_at: '2026-10-01T09:30:00.000Z',
    ...over,
  }
}

function event(over: Partial<CalendarRecord> = {}): CalendarRecord {
  return {
    calendar_id: 'grant@example.test',
    event_id: 'evt123',
    summary: 'Venue walk-through',
    excerpt: null,
    location: null,
    starts_at: '2026-10-13T09:00:00.000Z',
    ends_at: '2026-10-13T10:00:00.000Z',
    all_day: false,
    status: 'confirmed',
    html_link: null,
    remote_updated_at: null,
    ...over,
  }
}

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
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
    ...over,
  }
}

/** Undo RFC 5545 / RFC 6350 folding: a CRLF followed by one space is a continuation, not a line break. */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n /g, '')
    .split('\r\n')
    .filter((l) => l !== '')
}

/** A minimal RFC 4180 parser, written independently of the serialiser so a round trip proves something. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else {
      cell += ch
    }
  }
  return rows
}

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and line breaks, backslash first', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('leaves ordinary text unchanged', () => {
    expect(escapeText('Venue walk-through')).toBe('Venue walk-through')
  })
})

describe('foldLine', () => {
  it('returns a short line untouched', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('folds at 75 octets and unfolds back to the original', () => {
    const long = `DESCRIPTION:${'x'.repeat(200)}`
    const folded = foldLine(long)
    for (const physical of folded.split('\r\n')) {
      expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75)
    }
    expect(unfold(folded).join('')).toBe(long)
  })

  it('never splits a multi-byte character across lines', () => {
    const long = `NOTE:${'é'.repeat(80)}`
    const folded = foldLine(long)
    expect(unfold(folded).join('')).toBe(long)
    for (const physical of folded.split('\r\n')) {
      expect(physical).not.toMatch(/�/)
    }
  })
})

describe('utcBasic and dateBasicIn', () => {
  it('renders a UTC instant in the basic form', () => {
    expect(utcBasic('2026-10-13T09:05:00.000Z')).toBe('20261013T090500Z')
  })

  it('cuts an all-day date in the office zone, not in UTC', () => {
    // 21:00 UTC on the 12th is 00:00 on the 13th in Athens (UTC+3 in October).
    const instant = '2026-10-12T21:00:00.000Z'
    expect(dateBasicIn(instant, 'Europe/Athens')).toBe('20261013')
    expect(dateBasicIn(instant, 'UTC')).toBe('20261012')
  })

  it('refuses a value that is not a timestamp rather than writing NaN', () => {
    expect(() => utcBasic('not a date')).toThrow()
  })
})

describe('contactsToVcard', () => {
  it('writes a complete vCard 4.0 record with CRLF endings', () => {
    const text = contactsToVcard([contact()])
    expect(text.endsWith('\r\n')).toBe(true)
    const lines = unfold(text)
    expect(lines[0]).toBe('BEGIN:VCARD')
    expect(lines[1]).toBe('VERSION:4.0')
    expect(lines).toContain(`UID:urn:uuid:${CONTACT_ID}`)
    expect(lines).toContain('FN:Priya Shah')
    expect(lines).toContain('KIND:individual')
    expect(lines[lines.length - 1]).toBe('END:VCARD')
  })

  it('maps company and supplier to org, and everything else to individual', () => {
    expect(unfold(contactsToVcard([contact({ kind: 'company' })]))).toContain('KIND:org')
    expect(unfold(contactsToVcard([contact({ kind: 'supplier' })]))).toContain('KIND:org')
    expect(unfold(contactsToVcard([contact({ kind: 'collaborator' })]))).toContain(
      'KIND:individual',
    )
  })

  it('writes every populated field and omits the empty ones', () => {
    const full = unfold(
      contactsToVcard([
        contact({
          role: 'Head of ops',
          org: 'Acme; Ltd',
          email: 'priya@example.test',
          phone: '+44 20 7946 0000',
          instagram: 'priyashah',
          website: 'example.test/priya',
          where: '1 High Street, London',
          note: 'Met at the expo',
          next: 'Send deck',
          next_due: 'Friday',
          last_at: '2026-09-30T08:00:00.000Z',
        }),
      ]),
    )
    expect(full).toContain('TITLE:Head of ops')
    expect(full).toContain('ORG:Acme\\; Ltd')
    expect(full).toContain('EMAIL:priya@example.test')
    expect(full).toContain('TEL;VALUE=text:+44 20 7946 0000')
    expect(full).toContain('X-INSTAGRAM:priyashah')
    expect(full).toContain('URL:https://example.test/priya')
    expect(full).toContain('ADR;TYPE=work:;;1 High Street\\, London;;;;')
    expect(full).toContain('NOTE:Met at the expo\\nNext: Send deck\\nNext due: Friday')
    expect(full).toContain('X-LAST-CONTACTED:20260930T080000Z')
    expect(full).toContain('REV:20261001T093000Z')

    const sparse = unfold(contactsToVcard([contact()]))
    expect(sparse.some((l) => l.startsWith('EMAIL'))).toBe(false)
    expect(sparse.some((l) => l.startsWith('TEL'))).toBe(false)
    expect(sparse.some((l) => l.startsWith('URL'))).toBe(false)
    expect(sparse.some((l) => l.startsWith('NOTE'))).toBe(false)
  })

  it('keeps a website that is not a URI as text, rather than inventing a link', () => {
    const lines = unfold(contactsToVcard([contact({ website: 'see the shared folder' })]))
    expect(lines).toContain('X-WEBSITE:see the shared folder')
    expect(lines.some((l) => l.startsWith('URL'))).toBe(false)
  })

  it('cannot be broken out of by a name that contains a line break and a delimiter', () => {
    const hostile = contact({ name: 'Eve\nEND:VCARD\nBEGIN:VCARD\nFN:Mallory' })
    const lines = unfold(contactsToVcard([hostile]))
    expect(lines.filter((l) => l === 'BEGIN:VCARD')).toHaveLength(1)
    expect(lines.filter((l) => l === 'END:VCARD')).toHaveLength(1)
    expect(lines.filter((l) => l.startsWith('FN:'))).toHaveLength(1)
  })

  it('writes one card per contact, each complete on its own', () => {
    const text = contactsToVcard([contact(), contact({ contact_id: 'other', name: 'Tom Lee' })])
    expect(text.match(/BEGIN:VCARD/g)).toHaveLength(2)
    expect(text.match(/END:VCARD/g)).toHaveLength(2)
  })

  it('refuses a contact whose updated_at is not a timestamp', () => {
    expect(() => contactsToVcard([contact({ updated_at: 'yesterday' })])).toThrow()
  })
})

describe('eventsToIcal', () => {
  const opts = { exportedAt: '2026-10-13T12:00:00.000Z', zone: 'Europe/Athens' }

  it('writes a valid VCALENDAR envelope around each event', () => {
    const lines = unfold(eventsToIcal([event()], opts))
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('VERSION:2.0')
    expect(lines).toContain('BEGIN:VEVENT')
    expect(lines).toContain('END:VEVENT')
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR')
  })

  it('writes timed events in UTC with stable identifiers and the export stamp', () => {
    const lines = unfold(eventsToIcal([event()], opts))
    expect(lines).toContain('UID:grant@example.test/evt123@agentic-team')
    expect(lines).toContain('DTSTAMP:20261013T120000Z')
    expect(lines).toContain('DTSTART:20261013T090000Z')
    expect(lines).toContain('DTEND:20261013T100000Z')
    expect(lines).toContain('SUMMARY:Venue walk-through')
  })

  it('writes all-day events as dates in the office zone', () => {
    const lines = unfold(
      eventsToIcal(
        [
          event({
            all_day: true,
            starts_at: '2026-10-12T21:00:00.000Z',
            ends_at: '2026-10-13T21:00:00.000Z',
          }),
        ],
        opts,
      ),
    )
    expect(lines).toContain('DTSTART;VALUE=DATE:20261013')
    expect(lines).toContain('DTEND;VALUE=DATE:20261014')
  })

  it('maps status and carries cancellation rather than dropping the event', () => {
    const cancelled = unfold(eventsToIcal([event({ status: 'cancelled' })], opts))
    expect(cancelled).toContain('STATUS:CANCELLED')
    const tentative = unfold(eventsToIcal([event({ status: 'tentative' })], opts))
    expect(tentative).toContain('STATUS:TENTATIVE')
    const unknown = unfold(eventsToIcal([event({ status: 'mystery' })], opts))
    expect(unknown.some((l) => l.startsWith('STATUS'))).toBe(false)
  })

  it('omits an absent summary and writes an http link only', () => {
    const bare = unfold(
      eventsToIcal([event({ summary: null, html_link: 'javascript:alert(1)' })], opts),
    )
    expect(bare.some((l) => l.startsWith('SUMMARY'))).toBe(false)
    expect(bare.some((l) => l.startsWith('URL'))).toBe(false)
    const linked = unfold(
      eventsToIcal([event({ html_link: 'https://calendar.example.test/e/1' })], opts),
    )
    expect(linked).toContain('URL:https://calendar.example.test/e/1')
  })

  it('escapes a hostile summary so it cannot start a new event', () => {
    const lines = unfold(
      eventsToIcal([event({ summary: 'Lunch\nEND:VEVENT\nBEGIN:VEVENT' })], opts),
    )
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(1)
  })
})

describe('csvCell', () => {
  it('quotes a field containing a comma, a quote or a line break, doubling any quote', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"')
  })

  it('leaves a plain value unquoted, and null as an empty cell', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('writes booleans and numbers as their text, and never guards a number', () => {
    expect(csvCell(true)).toBe('true')
    expect(csvCell(-5)).toBe('-5')
  })

  it('guards a text cell a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("https://x.test")')).toBe(`"'=HYPERLINK(""https://x.test"")"`)
    expect(csvCell('+1 555')).toBe("'+1 555")
    expect(csvCell('-minus')).toBe("'-minus")
    expect(csvCell('@sum')).toBe("'@sum")
  })

  it('does not alter an ordinary title that merely contains a formula character', () => {
    expect(csvCell('Budget = 40k')).toBe('Budget = 40k')
  })
})

describe('tasksToCsv', () => {
  it('writes the header row in the declared column order', () => {
    const [header] = parseCsv(tasksToCsv([]))
    expect(header).toEqual([...TASK_CSV_COLUMNS])
  })

  it('round-trips awkward titles and details through a separate parser', () => {
    const tricky = [
      task({ title: 'Reply to "Ops", urgently', detail: 'line one\nline two' }),
      task({ task_id: 'b', title: '=cmd', detail: '', priority: -2, is_milestone: true }),
    ]
    const rows = parseCsv(tasksToCsv(tricky))
    expect(rows).toHaveLength(3)
    const titleIndex = TASK_CSV_COLUMNS.indexOf('title')
    const detailIndex = TASK_CSV_COLUMNS.indexOf('detail')
    expect(rows[1]?.[titleIndex]).toBe('Reply to "Ops", urgently')
    expect(rows[1]?.[detailIndex]).toBe('line one\nline two')
    expect(rows[2]?.[titleIndex]).toBe("'=cmd")
    expect(rows[2]?.[TASK_CSV_COLUMNS.indexOf('priority')]).toBe('-2')
    expect(rows[2]?.[TASK_CSV_COLUMNS.indexOf('is_milestone')]).toBe('true')
  })

  it('writes a null due date as an empty cell rather than the word null', () => {
    const rows = parseCsv(tasksToCsv([task({ due_on: null })]))
    expect(rows[1]?.[TASK_CSV_COLUMNS.indexOf('due_on')]).toBe('')
    expect(tasksToCsv([task({ due_on: null })])).not.toContain('null')
  })
})

describe('toJsonExport', () => {
  it('wraps records in a versioned envelope with a count', () => {
    const parsed = JSON.parse(
      toJsonExport('tasks', [task(), task({ task_id: 'b' })], {
        exportedAt: '2026-10-13T12:00:00.000Z',
        projectSlug: 'wellness',
      }),
    )
    expect(parsed.format).toBe('agentic-team.tasks')
    expect(parsed.version).toBe(1)
    expect(parsed.count).toBe(2)
    expect(parsed.project).toBe('wellness')
    expect(parsed.records).toHaveLength(2)
  })

  it('round-trips the records unchanged', () => {
    const records = [task()]
    const parsed = JSON.parse(
      toJsonExport('tasks', records, { exportedAt: '2026-10-13T12:00:00.000Z', projectSlug: 'p' }),
    )
    expect(parsed.records).toEqual(records)
  })
})
