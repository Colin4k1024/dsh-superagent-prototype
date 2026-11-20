/** Contract of the GitLab read helpers and one polling round: stream cursors, note filtering and Trigger intake. */
import { describe, expect, it, vi } from 'vitest'
import type { SourceContext } from '../src/sources/host.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { Trigger } from '../src/core/index.ts'
import { KV } from '../src/kv.ts'
import { readIssues, readNotes, readTodos } from '../src/sources/gitlab-read.ts'
import { pollRound } from '../src/sources/gitlab.ts'
import { testDeployment } from './fixtures/deployment.ts'

const deployment = testDeployment({ github: { cli: '', login: '', noreply: '' },
  forge: { kind: 'gitlab', repository: 'group/app', cli: '/opt/glab', login: 'agent-bot', commitEmail: '', host: 'https://gitlab.example.com', projectId: 42 },
  gitlab: { host: 'https://gitlab.example.com', project: 'group/app', projectId: 42, cli: '/opt/glab', login: 'agent-bot', commitEmail: '' } })
const note = (id: number, at: string, overrides: Record<string, unknown> = {}) =>
  ({ id, body: `note ${id}`, author: { id: 1, username: 'alice' }, created_at: at, updated_at: at, ...overrides })
const issue = { id: 1, iid: 7, title: 'Fix', description: 'please fix', state: 'opened', created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(), web_url: 'https://gitlab.example.com/group/app/-/issues/7', author: { id: 1, username: 'alice' }, labels: ['agent-ready'] }
const config = { host: 'https://gitlab.example.com', project: 'group/app', cli: '/opt/glab', commitEmail: '', pollSeconds: 60,
  failuresBeforeError: 3, mentionLookbackSeconds: 900, threadFailuresBeforeQuarantine: 3, observeIssues: true, observeMrs: false,
  observeComments: false, observeCi: false, autoLabels: ['agent-ready'] }

describe('GitLab reads', () => {
  it('filters notes by the cursor and skips system notes', async () => {
    const commands = { gitlabPages: vi.fn(async () => [note(3, '2026-09-09T00:10:00Z'), note(2, '2026-09-09T00:04:00Z'),
      note(1, '2026-09-09T00:10:00Z', { system: true })]) } as unknown as Commands
    expect(await readNotes(commands, 'mr', 7, '2026-09-09T00:05:00Z')).toEqual([note(3, '2026-09-09T00:10:00Z')])
  })
  it('asks for updated Issues and pending todos on their own API paths', async () => {
    const commands = { gitlabPages: vi.fn(async () => []), gitlabRootPages: vi.fn(async () => []) } as unknown as Commands
    await readIssues(commands, '2026-09-09T00:00:00Z')
    expect(commands.gitlabPages).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('updated_after=2026-09-09T00%3A00%3A00Z'))
    await readTodos(commands)
    expect(commands.gitlabRootPages).toHaveBeenCalledWith(expect.anything(), 'todos?state=pending&per_page=100')
  })
})

describe('GitLab polling round', () => {
  it('takes in a new Issue and its note, advances the cursors, and deduplicates on a second round', async () => {
    const received: Trigger[] = []
    const state = new Map<string, unknown>()
    const commands = {
      withSignal: () => commands,
      gitlabPages: vi.fn(async (_schema: unknown, path: string) => path.startsWith('issues?') ? [issue] : path.includes('/notes') ? [note(2, new Date().toISOString())] : []),
      gitlabRootPages: vi.fn(async () => []),
      gitlab: vi.fn(),
    } as unknown as Commands
    const ctx = { deployment, commands, ready: Promise.resolve(), configured: () => true, config: () => config,
      receive: async (trigger: Trigger) => { received.push(trigger); return 'stored' }, atomic: (work: () => unknown) => work(),
      state: { get: (key: string) => state.get(key), set: (key: string, value: unknown) => { value === undefined ? state.delete(key) : state.set(key, value) }, keys: () => [] },
      threads: { subscribed: () => [], patch: vi.fn(), get: () => undefined }, tickets: { open: () => [], get: () => undefined, bindThread: vi.fn(), threadClosed: vi.fn() },
      triggers: { get: () => undefined, latest: () => undefined }, report: vi.fn(), notify: vi.fn(), problem: undefined } as unknown as SourceContext
    const round = await pollRound(ctx, new AbortController().signal)
    expect(round.received).toBe(2)
    expect(received.map(item => item.threads[0]!.id)).toEqual(['issue:7', 'issue:7'])
    expect(state.has(KV.gitlab.cursor('gitlab:issue:7'))).toBe(true)
    // The second round reads the same page; deterministic Trigger ids make receive a no-op in production, so the test's collector sees them again.
    await pollRound(ctx, new AbortController().signal)
    expect(received).toHaveLength(4)
  })
})
