/**
 * A scripted OpenAI-compatible model, so Hermes can be driven with no real model and no cost.
 *
 * The user message chooses the behaviour (first word):
 *   TOOLS                      reply with the names of the tools Hermes offered the model (ground truth for what it may call)
 *   CALL <substring> <json>    call the first offered tool whose name contains <substring>; if none, say NO_SUCH_TOOL
 *   FORCECALL <name> <json>    call <name> even if it was NOT offered (a model hallucinating a tool: a negative control)
 *   DUMP <marker>              reply with what Hermes put in front of the model: message roles, whether <marker> is in the
 *                              system message, and the earlier user/assistant turns
 *   SLOW <seconds>             stream one token every 400 ms for <seconds>
 *   RATELIMIT                  answer HTTP 429 (a free-capacity limit)
 *   ERR500                     answer HTTP 500 (a provider failure)
 *   anything else              a short plain answer
 * After a tool result arrives the reply is "OK:" plus the start of that result, so a test can read what the tool returned.
 * A request that offers no tools (title generation and other side calls) gets "auxiliary reply".
 *
 * Environment: MOCK. Evidence from this file is about Hermes's behaviour, never about a model's quality.
 */
import { appendFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { close, listen, newServer, readBody, scrub, sendJson, sleep } from './lib.ts'

interface ChatMessage {
  role?: string
  content?: unknown
  tool_call_id?: string
}
interface ToolDef {
  function?: { name?: string }
}

export interface LlmDouble {
  readonly url: string
  stop: () => Promise<void>
}

const textOf = (c: unknown): string =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c
          .map((p) =>
            typeof p === 'object' && p !== null && 'text' in p
              ? String((p as { text: unknown }).text)
              : '',
          )
          .join('')
      : ''

const chunk = (delta: Record<string, unknown>, finish: string | null = null): string =>
  `data: ${JSON.stringify({
    id: 'chatcmpl-double',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`

export const startLlmDouble = async (
  logFile: string,
  options: { contextLength?: number } = {},
): Promise<LlmDouble> => {
  const server = newServer(async (req, res) => {
    const url = req.url ?? ''
    if (req.method === 'GET' && url.startsWith('/v1/models')) {
      sendJson(res, 200, {
        object: 'list',
        data: [
          { id: 'mock-model', object: 'model', context_length: options.contextLength ?? 131_072 },
        ],
      })
      return
    }
    if (req.method !== 'POST' || !url.startsWith('/v1/chat/completions')) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    const body = JSON.parse((await readBody(req, 8_000_000)) || '{}') as {
      messages?: ChatMessage[]
      tools?: ToolDef[]
      stream?: boolean
      model?: string
    }
    const messages = body.messages ?? []
    const offered = (body.tools ?? []).map((t) => t.function?.name ?? '').filter((n) => n !== '')
    const last = messages[messages.length - 1]
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const command = textOf(lastUser?.content).trim()
    appendFileSync(
      logFile,
      `${JSON.stringify({ at: Date.now(), model: body.model, stream: body.stream === true, offered, lastRole: last?.role, command: scrub(command).slice(0, 200), nMessages: messages.length })}\n`,
    )

    const reply = async (
      res2: ServerResponse,
      build: () => Promise<{ text?: string; call?: { name: string; args: string } }>,
    ) => {
      const out = await build()
      if (body.stream !== true) {
        const message =
          out.call === undefined
            ? { role: 'assistant', content: out.text ?? '' }
            : {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: out.call.name, arguments: out.call.args },
                  },
                ],
              }
        sendJson(res2, 200, {
          id: 'chatcmpl-double',
          object: 'chat.completion',
          created: 0,
          model: 'mock-model',
          choices: [
            { index: 0, message, finish_reason: out.call === undefined ? 'stop' : 'tool_calls' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
        return
      }
      res2.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res2.write(chunk({ role: 'assistant' }))
      if (out.call === undefined) {
        res2.write(chunk({ content: out.text ?? '' }))
        res2.write(chunk({}, 'stop'))
      } else {
        res2.write(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: out.call.name, arguments: out.call.args },
              },
            ],
          }),
        )
        res2.write(chunk({}, 'tool_calls'))
      }
      res2.write('data: [DONE]\n\n')
      res2.end()
    }

    // After a tool result: finish with what it returned.
    if (last?.role === 'tool') {
      await reply(res, async () => ({ text: `OK: ${scrub(textOf(last.content)).slice(0, 1500)}` }))
      return
    }
    const [verb = '', ...rest] = command.split(/\s+/)
    // Provider failures, for the failure-recovery experiments.
    if (verb === 'RATELIMIT') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' })
      res.end(
        JSON.stringify({
          error: { message: 'Rate limit exceeded: free-models-per-min. ', code: 429 },
        }),
      )
      return
    }
    if (verb === 'ERR500') {
      sendJson(res, 500, { error: { message: 'upstream exploded', code: 500 } })
      return
    }
    if (offered.length === 0 && verb !== 'SLOW') {
      // Not an agent turn (title generation, compression, a probe): answer plainly.
      await reply(res, async () => ({ text: 'auxiliary reply' }))
      return
    }
    if (verb === 'DUMP') {
      // Report what Hermes actually put in front of the model: the message roles in order, whether a marker string reached
      // the system message, and the earlier turns' text.
      const mark = rest[0] ?? ''
      const digest = {
        roles: messages.map((m) => m.role ?? '?'),
        systemHasMark:
          mark !== '' &&
          messages.some((m) => m.role === 'system' && textOf(m.content).includes(mark)),
        earlier: messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .slice(0, -1)
          .map((m) => `${m.role}:${textOf(m.content).slice(0, 60)}`),
      }
      await reply(res, async () => ({ text: `DUMP: ${JSON.stringify(digest)}` }))
      return
    }
    if (verb === 'TOOLS') {
      await reply(res, async () => ({ text: `TOOLS: ${JSON.stringify(offered)}` }))
      return
    }
    if (verb === 'CALL' || verb === 'FORCECALL') {
      const wanted = rest[0] ?? ''
      const args = rest.slice(1).join(' ') || '{}'
      const name = verb === 'FORCECALL' ? wanted : offered.find((n) => n.includes(wanted))
      await reply(res, async () =>
        name === undefined ? { text: `NO_SUCH_TOOL ${wanted}` } : { call: { name, args } },
      )
      return
    }
    if (verb === 'SLOW') {
      const seconds = Number(rest[0] ?? '30')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(chunk({ role: 'assistant' }))
      let open = true
      res.on('close', () => {
        open = false
      })
      const ticks = Math.ceil((seconds * 1000) / 400)
      for (let i = 0; i < ticks && open; i += 1) {
        res.write(chunk({ content: `tok${String(i)} ` }))
        await sleep(400)
      }
      if (open) {
        res.write(chunk({}, 'stop'))
        res.write('data: [DONE]\n\n')
        res.end()
      }
      return
    }
    await reply(res, async () => ({ text: 'a plain answer' }))
  })
  const port = await listen(server, 0)
  return { url: `http://127.0.0.1:${String(port)}`, stop: () => close(server) }
}
