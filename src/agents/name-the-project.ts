/**
 * When a reply names what to do next, it says which project each item belongs to (0.113.0, efficacy baseline T1).
 *
 * "What should I focus on today?" was answered with two deadlines and no project, so the person could not tell which piece of
 * work either belonged to. The line is added only for a question about what to do now, so other replies are not changed.
 */

const ASKS_WHAT_NEXT =
  /\b(?:focus|today|overdue|priorit(?:y|ies|ise|ize)|next|most important|first thing|this week)\b/i

export const NAME_THE_PROJECT_LINE =
  "Where you name a task, a deadline or a next step, say which project it belongs to, using that project's name as it " +
  'appears in the context. If an item belongs to no project, say that.'

export const asksWhatIsNext = (request: string): boolean => ASKS_WHAT_NEXT.test(request)
