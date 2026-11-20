/** Contract of the GitLab review-gate evaluator: approvals, size, sensitive paths and drafts. */
import { describe, expect, it } from 'vitest'
import { changeStats, evaluateGitlabReviewGate, matchPath } from '../examples/gitlab/review-gate.mjs'

const diff = (additions: number, deletions = 0) => `@@ -1 +1 @@\n${'+x\n'.repeat(additions)}${'-x\n'.repeat(deletions)}`
const change = (path: string, additions: number, deletions = 0) => ({ old_path: path, new_path: path, diff: diff(additions, deletions) })
const approvals = (...users: string[]) => ({ approved_by: users.map(username => ({ user: { username } })) })

describe('GitLab review gate', () => {
  it('needs one non-author approval for a small MR', () => {
    expect(evaluateGitlabReviewGate({ author: 'agent-bot', changes: [change('src/app.ts', 5)], approvals: approvals('alice') }))
      .toMatchObject({ passed: true, required: 1, lines: 5 })
    expect(evaluateGitlabReviewGate({ author: 'agent-bot', changes: [change('src/app.ts', 5)], approvals: approvals('agent-bot') }))
      .toMatchObject({ passed: false, required: 1, approvals: [] })
  })
  it('needs two approvals above the line limit or on a sensitive path', () => {
    const big = [change('src/app.ts', 201)]
    expect(evaluateGitlabReviewGate({ author: 'agent-bot', changes: big, approvals: approvals('alice') })).toMatchObject({ passed: false, required: 2, large: true })
    expect(evaluateGitlabReviewGate({ author: 'agent-bot', changes: big, approvals: approvals('alice', 'bob') })).toMatchObject({ passed: true, required: 2 })
    const sensitive = [change('src/auth/login.ts', 1)]
    expect(evaluateGitlabReviewGate({ author: 'agent-bot', changes: sensitive, approvals: approvals('alice') })).toMatchObject({ passed: false, sensitive: ['src/auth/login.ts'] })
  })
  it('fails a draft and matches the same small glob as the GitHub gate', () => {
    expect(evaluateGitlabReviewGate({ author: 'agent-bot', draft: true, changes: [change('src/app.ts', 1)], approvals: approvals('alice') }).passed).toBe(false)
    expect(matchPath('**/auth/**', 'src/auth/login.ts')).toBe(true)
    expect(matchPath('**/auth/**', 'src/authz/login.ts')).toBe(false)
    expect(changeStats([change('src/app.ts', 2, 1)]).lines).toBe(3)
  })
})
