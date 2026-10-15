/**
 * Where a plan's task lives, and who owns it (COS-096, COS-098, COS-099).
 *
 * Before this module every plan task went onto Grant's personal list, whoever the step was for. Internal work
 * ("draft the comparison", "file the follow-up") then became his to do, and the office asked him who should own
 * it. The rule is now stated once, here:
 *
 *   - a task for Grant himself (the step's audience is `grant`) is his: his personal list;
 *   - a task with no project to hold it has nowhere to be a project task, so it stays on his list until one exists;
 *   - every other task is a project task owned by the step's specialist, or by the Chief of Staff when the step
 *     names none. The Chief of Staff keeps accountability for work that no specialist was named for (COS-098).
 *
 * Grant is never the owner of ordinary internal work by default (COS-099).
 */
export type TaskHome =
  | { readonly kind: 'personal' }
  | { readonly kind: 'project'; readonly owner: string }

export interface TaskHomeInput {
  /** Who the output is for. `grant` means his own task. */
  readonly audience: string | null
  /** The specialist the step names, if any. */
  readonly specialist: string | null
  /** The job's project, or null when the work has none. */
  readonly projectId: string | null
}

export const CHIEF_OF_STAFF = 'chief-of-staff'

export const taskHome = (input: TaskHomeInput): TaskHome =>
  input.audience === 'grant' || input.projectId === null
    ? { kind: 'personal' }
    : { kind: 'project', owner: input.specialist ?? CHIEF_OF_STAFF }
