/*
 * THE EDGE COPY AND THE NODE ORIGINAL MUST ASK THE SAME THING.
 *
 * `transcribeOverApi` in `src/voice/inbound.ts` is how a Telegram voice note is
 * transcribed. The `/note` endpoint in `supabase/functions/voice/index.ts` does
 * the same job for a voice note recorded in the browser, and it CANNOT import
 * that function: every edge function in this repository is a single file,
 * uploaded alone.
 *
 * So the shape is duplicated, and CLAUDE.md's rule about duplicated facts
 * applies - the copy is the one that rots. This reads both files and asserts
 * they send the same fields to the same path. It is a source-text check on
 * purpose: the alternative is running Deno, and the failure being guarded
 * against is somebody changing one file and not the other, which the source
 * shows perfectly well.
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const node = await readFile('src/voice/inbound.ts', 'utf8')
const edge = await readFile('supabase/functions/voice/index.ts', 'utf8')

/* Only the function that talks to the speech service, so a mention elsewhere
   in either file cannot satisfy these on its own. */
const nodeCall = node.slice(node.indexOf('export async function transcribeOverApi'))
const edgeCall = edge.slice(edge.indexOf("url.pathname.endsWith('/note')"))

describe('the browser voice note and the Telegram voice note reach the same service', () => {
  it('posts to the same path', () => {
    expect(nodeCall).toContain('/audio/transcriptions')
    expect(edgeCall).toContain('/audio/transcriptions')
  })

  /*
    Every field the service is given. `file` is asserted through `append('file'`
    rather than through the variable names, which differ and are allowed to.
  */
  for (const field of ['file', 'model', 'response_format', 'language', 'prompt']) {
    it(`sends ${field}`, () => {
      expect(nodeCall).toContain(`append('${field}'`)
      expect(edgeCall).toContain(`append('${field}'`)
    })
  }

  it('sends the same response format and language, so one cannot drift to another', () => {
    for (const value of ["'response_format', 'json'", "'language', 'en'"]) {
      expect(nodeCall).toContain(value)
      expect(edgeCall).toContain(value)
    }
  })

  it('authorises with a bearer and never puts the key anywhere else', () => {
    expect(nodeCall).toContain('Authorization: `Bearer ${key}`')
    expect(edgeCall).toContain('Authorization: `Bearer ${key}`')
  })

  /*
    THE CONTROL. Every assertion above is a `toContain`, and a check made only
    of those passes against a file that has grown a SECOND, different call. So
    each file may talk to the speech service exactly once.
  */
  it('and each file has exactly one such call, so neither has grown a second', () => {
    const count = (s: string): number => s.split('/audio/transcriptions').length - 1
    expect(count(node)).toBe(1)
    expect(count(edge)).toBe(1)
  })
})

describe('the endpoint refuses honestly', () => {
  it('names what is missing without naming the credential', () => {
    expect(edgeCall).toContain('the office has no speech service configured')
    /* The refusal must not interpolate the key, the base url or the model. */
    const refusal = edgeCall.slice(
      edgeCall.indexOf('the office has no speech service configured') - 200,
      edgeCall.indexOf('the office has no speech service configured') + 120,
    )
    expect(refusal).not.toContain('${key}')
    expect(refusal).not.toContain('${baseUrl}')
  })

  it('refuses a recording that is empty, too short or too large rather than sending it', () => {
    expect(edgeCall).toContain('no audio was sent')
    expect(edgeCall).toContain('too short to hear')
    expect(edgeCall).toContain('too long to transcribe')
  })

  it('says so when the words could not be made out, rather than returning nothing', () => {
    expect(edgeCall).toContain('nothing could be made out')
  })
})
