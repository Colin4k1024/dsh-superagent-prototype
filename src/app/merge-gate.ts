/** The host-side merge gate: approvals, pipeline and size rules before the host merges a change. */
import type { ChangeSnapshot } from '../sources/forge.ts'

/** Paths whose change needs a second approval even when the diff is small. */
export const SENSITIVE_PATHS = ['auth', 'oauth', 'audit', 'policy', 'approval', 'isolation', 'migration'] as const
/** Additions plus deletions above which a second approval is required. */
export const MAX_LINES = 200
export type MergeDecision = { ok: true } | { ok: false; reason: string }
const sensitive = (paths: readonly string[]): boolean => paths.some(path => SENSITIVE_PATHS.some(word => path.toLowerCase().includes(word)))

/**
 * Decides whether the host may merge `change`. Missing pipeline, mergeability or approvals fail closed; a person can still
 * merge in GitLab, and the tool's refusal says why.
 */
export function mergeGate(change: ChangeSnapshot, options: { sha?: string } = {}): MergeDecision {
  if (change.state !== 'open') return { ok: false, reason: `The MR is ${change.state}, not open` }
  if (change.draft) return { ok: false, reason: 'The MR is a draft' }
  if (options.sha && change.headSha && options.sha !== change.headSha) return { ok: false, reason: 'The reviewed head SHA is not the current MR head; review the new head first' }
  if (change.mergeable === false) return { ok: false, reason: 'GitLab reports the MR as not mergeable (conflicts or a failing merge check)' }
  if (change.pipeline?.status !== 'success') return { ok: false, reason: `The MR pipeline is ${change.pipeline?.status ?? 'missing'}, not successful` }
  const approved = [...new Set(change.approvals?.approvedBy ?? [])].filter(user => user !== change.authorId)
  const lines = change.changes ? change.changes.additions + change.changes.deletions : 0
  const required = Math.max(1, lines > MAX_LINES || (change.changes?.paths && sensitive(change.changes.paths)) ? 2 : 1)
  if (approved.length < required) return { ok: false, reason: `The MR has ${approved.length} non-author approval(s); ${required} required` }
  return { ok: true }
}
