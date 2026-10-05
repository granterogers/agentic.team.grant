import { describe, expect, it } from 'vitest'
import { forbiddenIn, mask } from '../../scripts/forensics/preserve.ts'

// Specimens are assembled from pieces so no token-shaped literal sits in the repository.
const JWT = `${'ey'}${'J'}hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`
const SECRET = `${'sb_'}${'secret_'}AbCdEf12345`

describe('mask', () => {
  it('masks an email address and counts it', () => {
    const m = mask('{"actor":"someone@example.org","n":3}')
    expect(m.text).toBe('{"actor":"[email]","n":3}')
    expect(m.emails).toBe(1)
  })
  it('masks IPv4 and IPv6 addresses', () => {
    const m = mask('from 44.195.42.74 and 2a05:d014:1c06:5f02:7b89:5a59:3db:a81c and ::1 end')
    expect(m.text).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
    expect(m.text).not.toContain('2a05')
    expect(m.ips).toBeGreaterThanOrEqual(2)
  })
  it('leaves timestamps, durations and counts alone (the evidence itself)', () => {
    const text =
      '{"t":"2026-10-04T17:00:00","ms":118782,"msg":"checkpoint complete: write=30.280 s"}'
    expect(mask(text).text).toBe(text)
  })
})

describe('forbiddenIn can fail', () => {
  it('flags a JWT-shaped and a secret-key-shaped string', () => {
    expect(forbiddenIn(`token ${JWT}.payload.sig`).length).toBeGreaterThan(0)
    expect(forbiddenIn(`key ${SECRET}`).length).toBeGreaterThan(0)
  })
  it('control: ordinary evidence is clean', () => {
    expect(forbiddenIn('{"status":200,"ms":642,"rows":15}')).toEqual([])
  })
})
