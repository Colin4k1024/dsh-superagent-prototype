import { describe, expect, it } from 'vitest'
import { evaluateReviewGate, latestApprovals, matchPath } from '../examples/github/review-gate.mjs'

const pull = (overrides: Record<string, unknown> = {}) => ({ author: 'xiangzi-agent', additions: 10, deletions: 5,
  files: ['src/a.ts'], ...overrides })
const approved = (login = 'colin') => ({ user: { login }, state: 'APPROVED' })

describe('review gate', () => {
  it('matches the small glob dialect used by the gate config', () => {
    expect(matchPath('crates/audit/**', 'crates/audit/src/integrity.rs')).toBe(true)
    expect(matchPath('crates/audit/**', 'crates/auditable/src/integrity.rs')).toBe(false)
    expect(matchPath('**/auth/**', 'apps/gateway/src/auth/login.ts')).toBe(true)
    expect(matchPath('**/auth/**', 'apps/gateway/src/login.ts')).toBe(false)
    expect(matchPath('**/migrations/**', 'crates/persistence/migrations/0029.sql')).toBe(true)
    expect(matchPath('**/*.rs', 'src/a.rs')).toBe(true)
    expect(matchPath('**/*.rs', 'src/a.ts')).toBe(false)
  })
  it('needs one approval for a small, non-sensitive PR and never counts the author', () => {
    expect(evaluateReviewGate(pull(), []).passed).toBe(false)
    expect(evaluateReviewGate(pull(), [{ user: { login: 'xiangzi-agent' }, state: 'APPROVED' }]).passed).toBe(false)
    const result = evaluateReviewGate(pull(), [approved()])
    expect(result).toMatchObject({ passed: true, required: 1, approvals: ['colin'], lines: 15, large: false })
  })
  it('needs two approvals for a large PR', () => {
    const large = pull({ additions: 180, deletions: 21 })
    expect(evaluateReviewGate(large, [approved()])).toMatchObject({ passed: false, required: 2, large: true })
    expect(evaluateReviewGate(large, [approved('colin'), approved('alice')]).passed).toBe(true)
  })
  it('needs two approvals when a sensitive path is touched', () => {
    const sensitive = pull({ files: ['crates/audit/src/integrity.rs'] })
    const result = evaluateReviewGate(sensitive, [approved()])
    expect(result).toMatchObject({ passed: false, required: 2, large: false, sensitive: ['crates/audit/src/integrity.rs'] })
    expect(evaluateReviewGate(sensitive, [approved('colin'), approved('alice')]).passed).toBe(true)
  })
  it('treats the latest review per user as the decision, and ignores dismissals and comments', () => {
    expect(latestApprovals([
      { user: { login: 'colin' }, state: 'APPROVED' },
      { user: { login: 'colin' }, state: 'CHANGES_REQUESTED' },
    ])).toEqual([])
    expect(latestApprovals([
      { user: { login: 'colin' }, state: 'CHANGES_REQUESTED' },
      { user: { login: 'colin' }, state: 'APPROVED' },
      { user: { login: 'alice' }, state: 'COMMENTED' },
      { user: { login: 'bob' }, state: 'DISMISSED' },
    ])).toEqual(['colin'])
  })
  it('honours a config override for the size threshold and sensitive paths', () => {
    const result = evaluateReviewGate(pull({ additions: 5, files: ['src/a.ts'] }), [approved()],
      { maxLines: 4, sensitivePaths: ['src/a.ts'] })
    expect(result).toMatchObject({ passed: false, required: 2, large: true, sensitive: ['src/a.ts'] })
  })
})
