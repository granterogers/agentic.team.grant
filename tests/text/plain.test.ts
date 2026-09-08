import { describe, expect, it } from 'vitest'
import { count, howMany, list } from '../../src/text/plain.ts'

describe('saying numbers like a person', () => {
  it('never writes the (s) plural', () => {
    // The whole reason this module exists: `5 event(s)` is a programmer
    // declining to think about a plural, and Grant reads it as robotic.
    expect(count(1, 'event', 'events')).toBe('1 event')
    expect(count(5, 'event', 'events')).toBe('5 events')
    expect(count(0, 'event', 'events')).toBe('0 events')
  })

  it('groups thousands, because 1234 messages is not how it is said', () => {
    expect(count(1234, 'message', 'messages')).toBe('1,234 messages')
  })

  it('says "no" rather than nought where a person would', () => {
    expect(howMany(0, 'message', 'messages')).toBe('no messages')
    expect(howMany(1, 'message', 'messages')).toBe('1 message')
  })
})

describe('lists', () => {
  it('reads as a sentence at every length', () => {
    expect(list([])).toBe('nothing')
    expect(list(['Gmail'])).toBe('Gmail')
    expect(list(['Gmail', 'Drive'])).toBe('Gmail and Drive')
    expect(list(['Gmail', 'Drive', 'YouTube'])).toBe('Gmail, Drive and YouTube')
  })

  it('leaves out the Oxford comma, because the house voice is British', () => {
    expect(list(['a', 'b', 'c'])).not.toContain('b,and')
    expect(list(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
