/**
 * The one table of specimens the TypeScript shape validators (types.ts) and the SQL validators (migration 1070) are both run against.
 * `tests/engines/types.test.ts` runs the TypeScript half; `scripts/isolated/engine-runs.ts` runs the SQL half over the same table and
 * fails on any disagreement. Each refusal names the problem it expects, so a refusal for the wrong reason is not a pass.
 */
import type { EngineOutcome } from './types.ts'

export interface RequestCase {
  readonly name: string
  readonly request: unknown
  /** Null when the request is fine, else a fragment of the problem sentence. */
  readonly problem: string | null
}
export interface ResultCase {
  readonly name: string
  readonly outcome: EngineOutcome
  readonly result: unknown
  readonly problem: string | null
}

const good = {
  input: 'What did we decide about the venue?',
  instructions: 'You answer for the office.',
  conversation_history: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi' },
  ],
}
const turns = (n: number, content = 'x') =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content }))

export const REQUEST_CASES: readonly RequestCase[] = [
  { name: 'a complete request', request: good, problem: null },
  {
    name: 'an empty history is fine',
    request: { ...good, conversation_history: [] },
    problem: null,
  },
  {
    name: 'a model slug is fine',
    request: { ...good, model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    problem: null,
  },
  {
    name: 'exactly 20 turns',
    request: { ...good, conversation_history: turns(20) },
    problem: null,
  },
  { name: 'input at the limit', request: { ...good, input: 'a'.repeat(20_000) }, problem: null },
  { name: 'not an object', request: [1, 2], problem: 'not an object' },
  {
    name: 'an extra key',
    request: { ...good, tools: ['terminal'] },
    problem: 'a key it may not have',
  },
  { name: 'an empty input', request: { ...good, input: '   ' }, problem: 'input must be' },
  {
    name: 'input over the limit',
    request: { ...good, input: 'a'.repeat(20_001) },
    problem: 'input must be',
  },
  { name: 'input that is not a string', request: { ...good, input: 5 }, problem: 'input must be' },
  {
    name: 'instructions over the limit',
    request: { ...good, instructions: 'a'.repeat(12_001) },
    problem: 'instructions must be',
  },
  {
    name: 'no instructions',
    request: { input: 'hi', conversation_history: [] },
    problem: 'instructions must be',
  },
  {
    name: 'a history that is not an array',
    request: { ...good, conversation_history: 'no' },
    problem: 'must be an array',
  },
  {
    name: 'a turn with an extra key',
    request: { ...good, conversation_history: [{ role: 'user', content: 'x', name: 'y' }] },
    problem: 'every conversation turn',
  },
  {
    name: 'a turn with a system role',
    request: { ...good, conversation_history: [{ role: 'system', content: 'x' }] },
    problem: 'every conversation turn',
  },
  {
    name: 'a turn that is a string',
    request: { ...good, conversation_history: ['hello'] },
    problem: 'every conversation turn',
  },
  {
    name: 'twenty-one turns',
    request: { ...good, conversation_history: turns(21) },
    problem: 'more than 20 turns',
  },
  {
    name: 'a history over 24,000 characters',
    request: { ...good, conversation_history: turns(4, 'a'.repeat(6_001)) },
    problem: 'longer than 24,000',
  },
  {
    name: 'a model that is not a slug',
    request: { ...good, model: 'Bad Model!' },
    problem: 'model must be',
  },
  { name: 'a model that is a number', request: { ...good, model: 7 }, problem: 'model must be' },
]

const done = { tools_started: 2, approvals_denied: 0 }

export const RESULT_CASES: readonly ResultCase[] = [
  {
    name: 'a completed answer',
    outcome: 'completed',
    result: { ...done, answer: 'Here it is.' },
    problem: null,
  },
  {
    name: 'a completed answer with everything',
    outcome: 'completed',
    result: {
      ...done,
      answer: 'Here it is.',
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      hermes_run_id: `run_${'a'.repeat(32)}`,
      usage: { input_tokens: 1200, output_tokens: 80 },
      turn_exit_reason: 'completed',
      notes: ['approval.request denied'],
    },
    problem: null,
  },
  {
    name: 'a failed run with a sentence',
    outcome: 'failed',
    result: { ...done, failure: 'the model was over its limit' },
    problem: null,
  },
  { name: 'a cancelled run needs nothing more', outcome: 'cancelled', result: done, problem: null },
  { name: 'not an object', outcome: 'completed', result: 'done', problem: 'not an object' },
  {
    name: 'an extra key',
    outcome: 'completed',
    result: { ...done, answer: 'x', tool_calls: [] },
    problem: 'a key it may not have',
  },
  {
    name: 'completed with no answer',
    outcome: 'completed',
    result: done,
    problem: 'non-empty answer',
  },
  {
    name: 'completed with a blank answer',
    outcome: 'completed',
    result: { ...done, answer: '  ' },
    problem: 'non-empty answer',
  },
  {
    name: 'an answer over the limit',
    outcome: 'completed',
    result: { ...done, answer: 'a'.repeat(16_001) },
    problem: 'at most 16,000',
  },
  { name: 'failed with no sentence', outcome: 'failed', result: done, problem: 'failure sentence' },
  {
    name: 'missing counts',
    outcome: 'completed',
    result: { answer: 'x' },
    problem: 'required whole numbers',
  },
  {
    name: 'a negative count',
    outcome: 'completed',
    result: { tools_started: -1, approvals_denied: 0, answer: 'x' },
    problem: 'required whole numbers',
  },
  {
    name: 'a bad hermes run id',
    outcome: 'completed',
    result: { ...done, answer: 'x', hermes_run_id: 'run_1' },
    problem: 'not a Hermes run id',
  },
  {
    name: 'usage that is not whole numbers',
    outcome: 'completed',
    result: { ...done, answer: 'x', usage: { input_tokens: 1.5, output_tokens: 2 } },
    problem: 'usage must be',
  },
  {
    name: 'six notes',
    outcome: 'completed',
    result: { ...done, answer: 'x', notes: ['a', 'b', 'c', 'd', 'e', 'f'] },
    problem: 'at most five',
  },
  {
    name: 'a long note',
    outcome: 'completed',
    result: { ...done, answer: 'x', notes: ['a'.repeat(121)] },
    problem: 'at most five',
  },
]
