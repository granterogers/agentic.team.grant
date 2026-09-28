import type { HandlerOutput, Job } from './worker.ts'

/**
 * The dedupe key a channel delivers under (ledger R46): the output's own scope
 * when it has one (a question: `blocker:<id>`), else the job's result
 * (`job:<id>`). ONE expression for every channel, so a question and a result
 * can never share a key on one surface and collide on another.
 */
export const deliveryKey = (job: Job, output: HandlerOutput, channel: string): string =>
  `${output.deliveryScope ?? `job:${job.jobId}`}:${channel}`
