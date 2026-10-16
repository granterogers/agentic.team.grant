/** Types for the resume prompt (resume.mjs). */
import type { Ledger } from './state.d.mts'

export function resumePrompt(state: Ledger, options?: { readFirst?: string[]; sessionInstruction?: string }): string
