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
import { beginStep, finishStep } from '../jobs/checkpoint.ts'
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
          `select app.operator_chat('${pager.botId.replace(/'/g, "''")}') as c`,
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

      /*
        HIS OWN PRIVATE CHAT, not "the newest chat registered under his name" (#386).

        `telegram_chat_for` answers the newest deliverable chat attributed to him. Since 0607 only a private
        chat is attributed, and only to the person the office lists, but a credential export is not the
        place to lean on that: the chat must BE the Telegram user id the office lists for him. A private
        chat's id is its user's id, so his is on the list and a group's (negative) never is. Anything else
        is refused before a single secret is decrypted.
      */
      const own = (
        await db.execute(
          `select actor from public.subject_identities
            where subject = 'grant' and origin_channel = 'telegram' and kind = 'person'`,
        )
      ).rows.map((r) => String((r as { actor: string }).actor))
      if (!own.includes(String(chatId))) {
        return {
          ...base,
          body:
            'The chat registered for Grant is not his own private chat, so the vault was not built ' +
            'and nothing was sent. A copy of every credential goes only to him, and only there.',
        } satisfies HandlerOutput
      }

      /*
        ONCE (#386). Sending a copy of the vault cannot be undone, and the passphrase that opens it exists
        only in this process: a retry after "the file went and the passphrase did not" would build a
        DIFFERENT file. So the claim is made before anything is decrypted, and an attempt that started
        and did not finish is reconciled by a person rather than repeated.
      */
      const claim = await beginStep(
        db,
        job.jobId,
        'send',
        0,
        'external',
        'office.vault_export@1',
        job.jobId,
        job,
      )
      if (claim.kind === 'skip') {
        return {
          ...base,
          body: 'A copy of the vault has already been sent for this run. I have not sent another.',
        } satisfies HandlerOutput
      }
      if (claim.kind === 'paused') {
        return {
          ...base,
          body:
            `I stopped before sending the vault: ${claim.pause.detail} ` +
            `${claim.pause.resumeWhen}`,
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
      await finishStep(db, job.jobId, 'send', { credentials: sealed.items })

      return {
        ...base,
        body:
          `Sent you ${count(sealed.items, 'credential', 'credentials')}, encrypted, with the ` +
          'passphrase in a separate message. Keep the two apart.',
      } satisfies HandlerOutput
    },
  }
}
