/**
 * The REAL Telegram webhook, run in Node against the isolated replica.
 * The stand-in runtime and PostgREST are in edge-emulator.ts.
 */
import type { PgExecutor } from '../../src/db/pg-executor.ts'
import { startEdge } from './edge-emulator.ts'

export const WEBHOOK_SECRET = 'isolated-webhook-secret'

export interface Door {
  post(
    update: Record<string, unknown>,
    bot?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }>
  /** Every URL the door tried to reach that was not the replica. */
  readonly refusedUrls: string[]
  /** Make database calls fail, as an outage would - all of them, or only the named function. */
  outage(on: boolean, onlyFunction?: string): void
}

export async function startTelegramDoor(db: PgExecutor, botId: string): Promise<Door> {
  const edge = await startEdge({
    db,
    edgeFile: 'supabase/functions/telegram-webhook/index.ts',
    // The deploy uploads src/channels/telegram.ts AS ./telegram.ts.
    beside: [['src/channels/telegram.ts', 'telegram.ts']],
    env: {
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      TELEGRAM_BOT_ID: botId,
      SUPABASE_SERVICE_ROLE_KEY: 'isolated-service-key',
    },
  })
  return {
    refusedUrls: edge.refusedUrls,
    outage: edge.outage,
    post: async (update, bot) => {
      const r = await edge.call(
        new Request(
          `https://door.invalid/functions/v1/telegram-webhook${bot ? `?bot=${bot}` : ''}`,
          {
            method: 'POST',
            headers: {
              'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(update),
          },
        ),
      )
      const text = await r.text()
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(text) as Record<string, unknown>
      } catch {
        parsed = { raw: text }
      }
      return { status: r.status, body: parsed }
    },
  }
}
