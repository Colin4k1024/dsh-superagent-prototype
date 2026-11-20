/** Contract of the host merge gate: approvals, pipeline, size, sensitive paths and head SHA. */
import { describe, expect, it } from 'vitest'
import { mergeGate, MAX_LINES, SENSITIVE_PATHS } from '../src/app/merge-gate.ts'
import type { ChangeSnapshot } from '../src/sources/forge.ts'

const change = (overrides: Partial<ChangeSnapshot> = {}): ChangeSnapshot => ({ ref: { kind: 'change', number: 7 }, state: 'open',
  url: '', authorId: 'agent-bot', headSha: 'abc', sameProject: true, mergeable: true,
  pipeline: { status: 'success' }, approvals: { approvedBy: ['alice'] }, changes: { additions: 10, deletions: 2, paths: ['src/app.ts'] },
  ...overrides })

describe('host merge gate', () => {
  it('accepts an open, mergeable MR with a green pipeline and a non-author approval', () => {
    expect(mergeGate(change())).toEqual({ ok: true })
  })
  it('refuses a draft, a non-open MR, a missing pipeline, a non-mergeable MR and a stale head SHA', () => {
    expect(mergeGate(change({ draft: true })).ok).toBe(false)
    expect(mergeGate(change({ state: 'closed' })).ok).toBe(false)
    expect(mergeGate(change({ pipeline: undefined })).ok).toBe(false)
    expect(mergeGate(change({ pipeline: { status: 'failed' } })).ok).toBe(false)
    expect(mergeGate(change({ mergeable: false })).ok).toBe(false)
    expect(mergeGate(change(), { sha: 'other' }).ok).toBe(false)
  })
  it('needs a non-author approval; the author\'s own approval does not count', () => {
    expect(mergeGate(change({ approvals: { approvedBy: [] } })).ok).toBe(false)
    expect(mergeGate(change({ approvals: { approvedBy: ['agent-bot'] } })).ok).toBe(false)
  })
  it('needs two approvals for a large diff or a sensitive path', () => {
    expect(mergeGate(change({ changes: { additions: MAX_LINES + 1, deletions: 0, paths: ['src/app.ts'] } })).ok).toBe(false)
    expect(mergeGate(change({ changes: { additions: MAX_LINES + 1, deletions: 0, paths: ['src/app.ts'] }, approvals: { approvedBy: ['alice', 'bob'] } }))).toEqual({ ok: true })
    expect(mergeGate(change({ changes: { additions: 1, deletions: 0, paths: [`src/${SENSITIVE_PATHS[0]}.ts`] } })).ok).toBe(false)
    expect(mergeGate(change({ changes: { additions: 1, deletions: 0, paths: ['src/auth.ts'] }, approvals: { approvedBy: ['alice', 'bob'] } }))).toEqual({ ok: true })
  })
})
