/**
 * Comparing two fingerprints of "every office except the Sample's". Pure, so a test can show that it sees a change, and
 * that it is not fooled by an office appearing or vanishing.
 *
 * A fingerprint is `{ officeId: { table: digest } }`. A difference is reported as `office8:table` so the line says WHERE
 * without printing any content.
 */
export type Fingerprint = Record<string, Record<string, string>>

export const diffFingerprints = (before: Fingerprint, after: Fingerprint): string[] => {
  const out: string[] = []
  const offices = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const o of [...offices].sort()) {
    const b = before[o]
    const a = after[o]
    if (b === undefined || a === undefined) {
      out.push(`${o.slice(0, 8)}:${b === undefined ? 'office appeared' : 'office vanished'}`)
      continue
    }
    const tables = new Set([...Object.keys(b), ...Object.keys(a)])
    for (const t of [...tables].sort()) if (b[t] !== a[t]) out.push(`${o.slice(0, 8)}:${t}`)
  }
  return out
}
