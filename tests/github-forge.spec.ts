/** Contract of the GitHub ForgePort adapter: parsing, page URLs, change numbers and terminal notices. */
import { describe, expect, it } from 'vitest'
import type { Ticket } from '../src/core/index.ts'
import { githubForge } from '../src/sources/github-forge.ts'
import type { SourceContext } from '../src/sources/host.ts'

const ticket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: 'ticket-1', title: 'Fix the margin', decisionId: 'd1', channels: [], inputs: [], undelivered: [],
  mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'listed', sender: 'alice' }, actor: { source: 'feishu', id: 'alice' }, scope: 'small' },
  assignments: [], createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
  origin: { triggerId: 'request-1', triggerIds: ['request-1'] },
  follows: [{ thread: 'github:42', own: true }, { thread: 'github:7', own: true, closed: { at: '2026-09-09T01:00:00Z', outcome: 'merged' } }],
  ...overrides,
})

describe('GitHub ForgePort', () => {
  it('parses only its own change threads and builds the pull-request page', () => {
    expect(githubForge.change.parse('github:42')).toEqual({ kind: 'change', number: 42 })
    expect(githubForge.change.parse('gitlab:mr:42')).toBeUndefined()
    expect(githubForge.change.parse('github:')).toBeUndefined()
    expect(githubForge.pageUrl('acme/widgets', { kind: 'change', number: 42 })).toBe('https://github.com/acme/widgets/pull/42')
    expect(githubForge.changeWord).toBe('PR')
  })

  it('reports every followed change and filters closed ones when asked', () => {
    expect(githubForge.change.numbersOf(ticket())).toEqual([42, 7])
    expect(githubForge.change.numbersOf(ticket(), true)).toEqual([42])
    expect(githubForge.change.numbersOf(ticket({ follows: [] }))).toEqual([])
  })

  it('notifies a non-GitHub channel once when the ticket ends merged', () => {
    const ended = ticket({ ended: { at: '2026-09-09T02:00:00Z', by: 'executor', outcome: 'merged', reason: 'merged' },
      channels: [{ source: 'feishu', thread: 'feishu:chat:1', address: { chatId: 'chat', messageId: 'm1' } }],
      follows: [{ thread: 'github:42', own: true, closed: { at: '2026-09-09T02:00:00Z', outcome: 'merged' } }] })
    const ctx = { deployment: { repository: 'acme/widgets' } } as SourceContext
    const notices = githubForge.change.terminalNotices(ctx, ended, '请修复')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'notice', channel: { source: 'feishu' } })
    expect(notices[0]!.text).toContain('PR #42')
    // It selects the last closed pull request the ticket opened, and its id is stable across retries.
    expect(githubForge.change.terminalNotices(ctx, ended, '请修复')[0]!.id).toBe(notices[0]!.id)
  })
})
