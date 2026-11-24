/**
 * The line that names the one message a reply answers, placed at the end of the context for a turn in a conversation.
 *
 * Stress tests of 22 November 2026: the team answered an EARLIER question in the same thread, because the context said which
 * message was the latest only by its place in the list. Repeating the latest message's own words, once, in quotes, tells the
 * model which message the reply is to. The words are cut at 500 characters so one long message cannot crowd out the context,
 * and JSON quoting keeps a newline or a quote inside the message from breaking the line.
 */
export const ANSWERING_NOW_LIMIT = 500

export const answeringNowLine = (instruction: string): string =>
  `The message you are answering now, and only this one, is: ${JSON.stringify(instruction.slice(0, ANSWERING_NOW_LIMIT))}\n\n`
