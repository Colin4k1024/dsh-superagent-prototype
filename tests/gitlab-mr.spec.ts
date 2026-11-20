/** Contract of GitLab MR binding, lifecycle observation and terminal notices. */
import { describe, expect, it, vi } from 'vitest'
import type { ChangeSnapshot } from '../src/sources/forge.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { claimChange, observeChange, readChange, snapshotOf, terminalNotices } from '../src/sources/gitlab-mr.ts'
import type { Ticket, Trigger } from '../src/core/index.ts'
import { testDeployment } from './fixtures/deployment.ts'

const deployment = testDeployment({ github: { cli: '', login: '', noreply: '' },
  forge: { kind: 'gitlab', repository: 'group/app', cli: '/opt/glab', login: 'agent-bot', commitEmail: '', host: 'https://gitlab.example.com', projectId: 42 },
  gitlab: { host: 'https://gitlab.example.com', project: 'group/app', projectId: 42, cli: '/opt/glab', login: 'agent-bot', commitEmail: '' } })
const trigger: Trigger = { id: 'tr1', source: 'gitlab', threads: [{ source: 'gitlab', id: 'mr:7' }], actor: { source: 'gitlab', id: 'alice' },
  human: true, at: '2026-09-09T00:00:00Z', text: 'fix', meta: { item: 'mr', iid: 7 } }
const ticket = (overrides: Record<string, unknown> = {}): Ticket => ({ id: 't1', title: 'Fix', decisionId: 'd1', channels: [], inputs: [], undelivered: [],
  mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'listed', sender: 'alice' }, actor: { source: 'gitlab', id: 'alice' }, scope: 'small' },
  assignments: [], createdAt: '', updatedAt: '', origin: { triggerId: 'tr1', triggerIds: ['tr1'] },
  execution: { name: 'fix', directory: '/work', assignment: '' }, follows: [], ...overrides } as unknown as Ticket)
const change = (overrides: Partial<ChangeSnapshot> = {}): ChangeSnapshot => ({ ref: { kind: 'change', number: 7 }, state: 'open',
  url: 'https://gitlab.example.com/group/app/-/merge_requests/7', authorId: 'agent-bot', headSha: 'abc', headBranch: 'agent/fix',
  baseBranch: 'main', sameProject: true, ...overrides })
const host = (tickets: Ticket[], changes = new Map<string, Ticket>()) => {
  const bind = vi.fn(), closed = vi.fn(), patch = vi.fn()
  const ctx = { deployment, triggers: { get: (id: string) => id === 'tr1' ? trigger : undefined },
    tickets: { get: (id: string) => changes.get(id) ?? tickets.find(item => item.id === id), open: () => tickets, bindThread: bind, threadClosed: closed },
    threads: { patch }, atomic: (work: () => unknown) => work(), commands: {} } as unknown as SourceContext
  return { ctx, bind, closed, patch }
}

describe('GitLab merge request binding', () => {
  it('binds the origin MR and records its Thread facts', () => {
    const t = ticket(); const { ctx, bind } = host([t])
    expect(claimChange(ctx, t.id, change())).toBeUndefined()
    expect(bind).toHaveBeenCalledWith(t.id, { source: 'gitlab', id: 'mr:7' }, true)
  })
  it('binds an agent MR on the ticket branch, and refuses an unrelated MR', () => {
    const t = ticket(); const { ctx, bind } = host([{ ...t, origin: { triggerId: 'other', triggerIds: ['other'] } } as Ticket])
    expect(claimChange(ctx, t.id, change({ headBranch: 'agent/fix' }))).toBeUndefined()
    expect(bind).toHaveBeenCalledWith(t.id, { source: 'gitlab', id: 'mr:7' }, true)
    const unrelated = host([{ ...t, origin: { triggerId: 'other', triggerIds: ['other'] } } as Ticket])
    expect(claimChange(unrelated.ctx, t.id, change({ headBranch: 'agent/other' }))).toContain('does not belong')
  })
  it('refuses an MR already bound to another open ticket', () => {
    const other = ticket({ id: 't2', follows: [{ thread: 'gitlab:mr:7', own: true }] })
    const t = ticket({ id: 't1' }); const { ctx } = host([t, other])
    expect(claimChange(ctx, t.id, change())).toBe('MR already belongs to another active ticket')
  })
  it('ends a following ticket only on merged or closed, not on an open MR', async () => {
    const t = ticket({ follows: [{ thread: 'gitlab:mr:7', own: true }] }); const { ctx, closed } = host([t])
    expect(await observeChange(ctx, change())).toBe(false); expect(closed).not.toHaveBeenCalled()
    expect(await observeChange(ctx, change({ state: 'merged', mergedAt: '2026-09-09T01:00:00Z' }))).toBe(true)
    expect(closed).toHaveBeenCalledWith({ source: 'gitlab', id: 'mr:7' }, 'merged', '2026-09-09T01:00:00Z')
  })
  it('projects one MR and notifies non-GitLab channels once when it merged', async () => {
    const mr = { id: 1, iid: 7, title: 'Fix', description: '', state: 'merged', created_at: '2026-09-09T00:00:00Z',
      web_url: 'https://gitlab.example.com/group/app/-/merge_requests/7', author: { id: 1, username: 'agent-bot' },
      merged_at: '2026-09-09T01:00:00Z', closed_at: null, source_project_id: 42, target_project_id: 42, source_branch: 'agent/fix', target_branch: 'main' }
    const commands = { withSignal: () => commands, gitlab: vi.fn(async () => mr) } as unknown as SourceContext['commands']
    const ctx = { ...host([ticket()]).ctx, commands } as SourceContext
    expect(await readChange(ctx, { kind: 'change', number: 7 })).toMatchObject({ state: 'merged', authorId: 'agent-bot', sameProject: true })
    const ended = ticket({ ended: { at: '2026-09-09T01:00:00Z', by: 'executor', outcome: 'merged', reason: 'merged' },
      follows: [{ thread: 'gitlab:mr:7', own: true, closed: { at: '2026-09-09T01:00:00Z', outcome: 'merged' } }],
      channels: [{ source: 'feishu', thread: 'feishu:chat:1', address: { chatId: 'chat', messageId: 'm1' } }] })
    const notices = terminalNotices(ctx, ended, '请修复')
    expect(notices).toHaveLength(1); expect(notices[0]!.text).toContain('MR !7'); expect(notices[0]!.channel.source).toBe('feishu')
    expect(snapshotOf(mr, deployment)).toMatchObject({ state: 'merged', headBranch: 'agent/fix', baseBranch: 'main' })
  })
})
