/**
 * Send Grant an encrypted copy of the vault.
 *
 * §16, and the half `portable.ts` deliberately leaves out: the database backup
 * excludes credentials on purpose, so a restore gives a working database with
 * an empty vault. This is the file that refills it.
 *
 * `src/backup/vault-export.ts` does the work and explains why it reproduces
 * openssl's container byte for byte rather than choosing a nicer format. This
 * file is the part that decides where it goes.
 *
 * ## Why the duty is off
 *
 * Because switching it on means a copy of every credential this system holds
 * arriving on Telegram every week, and that is a judgement about Grant's own
 * risk rather than a technical gap. It is also the only copy of the
 * credentials that would survive losing the Supabase project, so the argument
 * runs both ways and he is the one who should settle it.
 *
 * The handler is built, tested and wired. `update public.responsibilities set
 * enabled = true where slug = 'vault-export'` is the whole of switching it on.
 *
 * ## What it never does
 *
 * Print anything. Not the secrets, not the passphrase, not the filename with
 * the passphrase in the same line. The output body says how many credentials
 * went and nothing else, because that body is stored in `outputs`, shown on a
 * page, and posted to Slack.
 */

import { buildVaultExport, sendSealedVault } from '../backup/vault-export.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { pagerBot } from '../telegram/roster.ts'
import { count } from '../text/plain.ts'

export function vaultExportHandler(db: SqlExecutor): Handler {
  return {
    kind: 'office.vault_export',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }

      const pager = await pagerBot(db)
      if (pager === null) {
        return {
          ...base,
          body: 'There is no pager bot, so there is nowhere to send the vault. Nothing was built.',
        } satisfies HandlerOutput
      }

      const chatId = (
        await db.execute(
          `select app.telegram_chat_for('grant', '${pager.botId.replace(/'/g, "''")}') as c`,
        )
      ).rows[0]?.c
      if (chatId === null || chatId === undefined) {
        return {
          ...base,
          body:
            'No Telegram chat is registered for Grant, so the vault has nowhere to go. ' +
            'Nothing was built — the file is only ever created once there is somewhere ' +
            'to send it.',
        } satisfies HandlerOutput
      }

      // Read LAST, and only once there is a destination. A decrypted vault
      // sitting in this process while we work out where to send it is a
      // decrypted vault in a crash dump for no reason.
      const rows = (
        await db.execute(`
          select name, decrypted_secret as value, coalesce(description, '') as description
            from vault.decrypted_secrets order by name
        `)
      ).rows as { name: string; value: string; description: string }[]

      const sealed = await buildVaultExport(rows)
      await sendSealedVault(pager.token, String(chatId), sealed)

      return {
        ...base,
        body:
          `Sent you ${count(sealed.items, 'credential', 'credentials')}, encrypted, with the ` +
          'passphrase in a separate message. Keep the two apart.',
      } satisfies HandlerOutput
    },
  }
}
