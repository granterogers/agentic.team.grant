/** The pure halves of web research. Every decision a run makes, proved on plain data, each with its negative control. */
import { describe, expect, it } from 'vitest'
import { termsOf, whyNotFollowed } from '../../src/browser/links.ts'
import {
  budgetFrom,
  chooseLinks,
  composeFindings,
  extractPassages,
  LIMITS,
  pageSource,
  pickResults,
} from '../../src/browser/research.ts'

const r = (url: string, rank = 1) => ({ rank, snippet: '', title: url, url })

describe('budgetFrom', () => {
  it('holds a request under the ceilings however large it asks', () => {
    const b = budgetFrom({ follow: 99, max_downloads: 99, max_pages: 99, max_results: 99 })
    expect(b).toEqual({
      downloads: LIMITS.maxDownloads,
      follow: LIMITS.maxFollow,
      pages: LIMITS.maxPages,
      results: LIMITS.maxResults,
    })
  })
  it('falls back to modest defaults on nonsense, and results never exceed pages', () => {
    expect(budgetFrom({ max_pages: 'lots', follow: -3 })).toEqual({
      downloads: 1,
      follow: 2,
      pages: 6,
      results: 4,
    })
    expect(budgetFrom({ max_pages: 2, max_results: 6 }).results).toBe(2)
  })
  it('there is no depth to configure: one hop is by construction', () => {
    expect(Object.keys(budgetFrom({ depth: 5, max_depth: 5 }))).not.toContain('depth')
  })
})

describe('pickResults', () => {
  it('skips private addresses, files, repeats and more than two from a host', () => {
    const picked = pickResults(
      [
        r('http://10.0.0.5/admin'),
        r('https://a.example/one.pdf'),
        r('https://a.example/1'),
        r('https://a.example/2'),
        r('https://a.example/3'),
        r('https://b.example/x'),
        r('https://b.example/x?utm_source=z'),
      ],
      6,
    )
    expect(picked.map((p) => p.url)).toEqual([
      'https://a.example/1',
      'https://a.example/2',
      'https://b.example/x',
    ])
  })
  it('does not re-read a page already read, and respects the maximum', () => {
    expect(pickResults([r('https://a.example/1')], 3, new Set(['https://a.example/1']))).toEqual([])
    expect(
      pickResults(
        [r('https://a.example/1'), r('https://b.example/1'), r('https://c.example/1')],
        2,
      ),
    ).toHaveLength(2)
  })
})

describe('whyNotFollowed: a GET can act, so an act is not followed', () => {
  const acts = [
    ['https://shop.example/cart/add/9', 'Add'],
    ['https://shop.example/checkout', 'Checkout'],
    ['https://site.example/logout', 'Sign out'],
    ['https://site.example/unsubscribe?id=4', 'Unsubscribe'],
    ['https://site.example/orders/42/cancel', 'Cancel order'],
    ['https://site.example/page?action=delete&id=3', 'Open'],
    ['https://site.example/x', 'Buy now'],
    ['https://site.example/x', 'Book a table'],
    ['https://site.example/x', 'Send message'],
    ['https://site.example/x', 'Publish'],
    ['https://site.example/x', 'Post a comment'],
    ['https://site.example/x', 'Submit your application'],
    ['https://site.example/x', 'Donate'],
  ] as const
  for (const [url, text] of acts) {
    it(`refuses ${text} -> ${url}`, () => {
      expect(whyNotFollowed({ text, url })).not.toBeNull()
    })
  }
  it('control: ordinary reading links are followable', () => {
    for (const [url, text] of [
      ['https://site.example/guide/widgets', 'Widget guide'],
      ['https://site.example/blog/2026/pricing-changes', 'Pricing changes in 2026'],
      ['https://site.example/about', 'About us'],
    ] as const) {
      expect(whyNotFollowed({ text, url }), text).toBeNull()
    }
  })
})

describe('chooseLinks', () => {
  const terms = termsOf('widget pricing for small shops')
  const page = {
    links: [
      { text: 'Widget pricing explained', url: 'https://x.example/widget-pricing' },
      { text: 'Pricing sheet', url: 'https://x.example/files/pricing.pdf' },
      { text: 'Add widget to cart', url: 'https://x.example/cart/add/1' },
      { text: 'Log out', url: 'https://x.example/logout' },
      { text: 'Careers', url: 'https://x.example/careers' },
      { text: 'Local widget', url: 'http://192.168.1.1/widget' },
      { text: 'Widget pricing explained again', url: 'https://x.example/widget-pricing#top' },
    ],
    url: 'https://x.example/',
  }
  const got = chooseLinks([page], terms, 5, new Set())
  it('follows only relevant, public, non-acting links, once each', () => {
    expect(got.map((g) => g.link.url).sort()).toEqual([
      'https://x.example/files/pricing.pdf',
      'https://x.example/widget-pricing',
    ])
  })
  it('routes a relevant file to download and a page to read', () => {
    expect(got.find((g) => g.link.url.endsWith('.pdf'))?.how).toBe('download')
    expect(got.find((g) => g.link.url.endsWith('widget-pricing'))?.how).toBe('read')
  })
  it('skips what was already read and respects the maximum', () => {
    expect(
      chooseLinks([page], terms, 5, new Set(['https://x.example/widget-pricing'])),
    ).toHaveLength(1)
    expect(chooseLinks([page], terms, 1, new Set())).toHaveLength(1)
  })
  it('control: with no matching terms it follows nothing (a crawl is not research)', () => {
    expect(chooseLinks([page], termsOf('zebra migration'), 5, new Set())).toEqual([])
  })
})

describe('extractPassages', () => {
  const text =
    'The company was founded in a garage long ago and grew slowly. Widget pricing for small shops starts at forty pounds a month, billed annually. ' +
    'Our offices are closed on bank holidays. Small shops get a discount on widget pricing when they sign for two years or more.'
  it('lifts the sentences that speak to the question, in page order, unparaphrased', () => {
    const got = extractPassages(text, termsOf('widget pricing small shops'), 2)
    expect(got).toHaveLength(2)
    expect(got[0]).toContain('starts at forty pounds')
    expect(got[1]).toContain('discount on widget pricing')
    for (const g of got) expect(text).toContain(g)
  })
  it('control: nothing relevant returns nothing rather than filler', () => {
    expect(extractPassages(text, termsOf('zebra migration patterns'))).toEqual([])
  })
})

describe('composeFindings', () => {
  const page = {
    documentId: '11111111-1111-1111-1111-111111111111',
    how: 'search' as const,
    passages: ['Widgets cost forty pounds.'],
    retrievedOn: '2026-10-04',
    title: 'Widget prices',
    url: 'https://x.example/widgets',
  }
  it('cites the saved row, names the page and the day, and says it only read', () => {
    const body = composeFindings('widget prices', [page], [])
    expect(body).toContain('[browser:11111111-1111-1111-1111-111111111111]')
    expect(body).toContain('https://x.example/widgets')
    expect(body).toContain('2026-10-04')
    expect(body).toContain('Widgets cost forty pounds.')
    expect(body).toMatch(/did not press, submit or send/)
  })
  it('says plainly when nothing was kept, and keeps no pretence', () => {
    const body = composeFindings(
      'widget prices',
      [],
      ['The search itself did not work (timed out).'],
    )
    expect(body).toMatch(/nothing to report/)
    expect(body).toMatch(/kept nothing/)
    expect(body).not.toContain('[browser:')
  })
  it('pageSource is the citation the reader counts: browser:<id> then words', () => {
    expect(pageSource(page)).toBe(
      'browser:11111111-1111-1111-1111-111111111111 Widget prices (https://x.example/widgets)',
    )
  })
})
