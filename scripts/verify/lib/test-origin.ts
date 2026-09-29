/**
 * Declare a conversation as test traffic BEFORE driving a real door (#381).
 *
 * A suite that posts a correctly signed update to the deployed Telegram or
 * Slack webhook, says something through the dashboard gateway, or calls the
 * office's MCP server, produces exactly what Grant produces: the adapter
 * writes the same key, and 0603 rightly trusts it. So the suite says so
 * first. `app.register_test_origin` records the conversation, and the
 * ingress stamp writes every turn in it `synthetic` at the moment it
 * arrives - which every child inherits and nothing can undo.
 *
 * The database refuses to declare a conversation with any evidence of real
 * use (his chats, a real project's Slack channel, a project or client with
 * real work), so the conversation must be a fixture, and these helpers mint
 * one: a Telegram chat id and a Slack channel id no real conversation has.
 *
 *   const origins = await testOrigins(db, 'verify:latency')
 *   const chat = origins.telegramChat()
 *   await origins.declare('telegram', chat)       // before the POST
 *   ... post ...
 *   await origins.release()                        // ends the window; deletes nothing
 */
import type { SqlExecutor } from '../../../src/db/executor.ts'

export type Door = 'telegram' | 'slack' | 'voice' | 'teamhq' | 'mcp'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface TestOrigins {
  /** The run token every declaration of this run carries. */
  readonly token: string
  /** Declare a conversation; throws (with the database's reason) if it is real. */
  declare(channel: Door, conversation: string): Promise<string>
  /** A Telegram chat id outside every real chat's range: -7 followed by 15 digits. */
  telegramChat(): string
  /** A Slack channel id in Slack's alphabet that no workspace issues: C0ZT + 8. */
  slackChannel(): string
  /** End the run's window. The declarations stay, as evidence. */
  release(): Promise<number>
}

export async function testOrigins(db: SqlExecutor, registeredBy: string): Promise<TestOrigins> {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24)
  let n = 0
  const digits = (len: number): string =>
    `${String(Date.now())}${String(Math.floor(Math.random() * 1e9))}${String(n++)}`
      .replace(/\D/g, '')
      .slice(-len)
      .padStart(len, '0')
  return {
    token,
    async declare(channel, conversation) {
      const r = await db.execute(
        `select app.register_test_origin(${lit(channel)}, ${lit(conversation)}, ${lit(token)}, ${lit(registeredBy)})::text as id`,
      )
      const id = (r.rows[0] as { id?: string } | undefined)?.id
      if (typeof id !== 'string') throw new Error(`could not declare ${channel} ${conversation}`)
      return id
    },
    telegramChat: () => `-7${digits(15)}`,
    slackChannel: () =>
      `C0ZT${`${Date.now().toString(36)}${String(n++)}${Math.random().toString(36).slice(2)}`
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(-8)
        .padStart(8, '0')}`,
    async release() {
      const r = await db.execute(`select app.release_test_origins(${lit(token)}) as n`)
      return Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0)
    },
  }
}
