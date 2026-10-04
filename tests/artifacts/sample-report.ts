import type { Report } from '../../src/artifacts/report.ts'

/** A report that exercises every block kind, with a fixed date so its bytes are reproducible. */
export const SAMPLE: Report = {
  author: 'Agentic Team',
  blocks: [
    {
      kind: 'paragraph',
      text: 'This report sets out what the project holds on the plot purchase and what remains open before exchange.',
      lead: true,
    },
    { kind: 'heading', level: 1, text: 'Where things stand' },
    {
      kind: 'paragraph',
      text: 'The survey is booked for the fourteenth. The vendor has not yet replied about the boundary hedge, and the solicitor wants the drainage search before anything is signed. None of the figures below has been confirmed in writing.',
    },
    { kind: 'heading', level: 2, text: 'Open items' },
    {
      kind: 'bullets',
      items: [
        'Chase the vendor about the hedge',
        'Get the drainage search ordered',
        'Confirm the survey slot with the surveyor',
      ],
    },
    { kind: 'numbers', items: ['Survey', 'Drainage search', 'Exchange'] },
    {
      kind: 'quote',
      text: 'Do not exchange until the drainage search is back.',
      attribution: 'The solicitor',
    },
    {
      kind: 'table',
      columns: ['Item', 'Owner', 'Due'],
      rows: [
        ['Survey', 'Surveyor', '14 Oct'],
        ['Drainage search', 'Solicitor', '18 Oct'],
        ['Hedge reply', 'Vendor', 'unknown'],
      ],
    },
    {
      kind: 'chart',
      title: 'Cost by line',
      bars: [
        { label: 'Purchase', value: 410 },
        { label: 'Survey', value: 32 },
        { label: 'Legal', value: 18 },
      ],
      caption: 'Thousands of pounds, estimated.',
    },
  ],
  created: new Date('2026-10-04T12:00:00Z'),
  sources: [{ label: 'Plot notes', ref: 'document:abc Plot notes' }],
  subtitle:
    'This report sets out what the project holds on the plot purchase and what remains open before exchange.',
  title: 'Plot purchase status',
} as Report
