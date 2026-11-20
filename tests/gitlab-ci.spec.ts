/** Contract of GitLab CI/repository/thread reads and the checks ForgePort. */
import { describe, expect, it, vi } from 'vitest'
import type { Commands } from '../src/infra/commands.ts'
import type { Trigger } from '../src/core/index.ts'
import { ciCounts, ciFact, ciFailures, ciSummary, gitlabChecks, gitlabRepositoryRead, gitlabThreadContext, readRepositoryPath }
  from '../src/sources/gitlab-read.ts'
import { branchPipelineTrigger, mergeRequestPipelineTrigger } from '../src/sources/gitlab-trigger.ts'

const rawJobs = [{ name: 'lint', status: 'success', allow_failure: false }, { name: 'test', status: 'failed', allow_failure: false },
  { name: 'optional', status: 'failed', allow_failure: true }, { name: 'deploy', status: 'manual', allow_failure: false }]
const jobs = rawJobs.map(job => ({ name: job.name, status: job.status, allowFailure: job.allow_failure }))
const snapshot = { status: 'failed', jobs }
const note = (id: number, at: string) => ({ id, body: `note ${id}`, author: { id: 1, username: 'alice' }, created_at: at, updated_at: at })
const commands = (overrides: Partial<Record<string, unknown>> = {}) => ({
  gitlabPages: vi.fn(async (_schema: unknown, path: string) => path.includes('/notes') ? [note(1, '2026-09-09T00:00:00Z'), note(2, '2026-09-09T00:01:00Z')]
    : path.includes('/discussions') ? [] : []),
  gitlab: vi.fn(async (first: unknown, second?: string) => { const path = typeof first === 'string' ? first : second ?? ''
    return path === '' ? { id: 42, default_branch: 'main' } : path.startsWith('repository/files/') ? 'file body'
      : path.startsWith('repository/tree') ? [{ name: 'src' }, { name: '.hidden' }] : [] }),
  ...overrides,
} as unknown as Commands)

describe('GitLab CI and repository reads', () => {
  it('counts failures, ignores allow_failure and manual as a failure, and summarizes the pipeline', () => {
    expect(ciCounts(snapshot)).toEqual({ failed: 1, running: 1 })
    expect(ciFailures(snapshot)).toEqual(['test'])
    expect(ciSummary(snapshot, 'MR !7', 'gitlab/merge_requests/7/pipelines')).toContain('failed 1/4')
    expect(ciFact(snapshot)).toMatchObject({ label: 'CI failed', value: '1', problem: true })
    expect(ciFact({ status: 'success', jobs: [{ name: 'lint', status: 'success', allowFailure: false }] })).toMatchObject({ value: 'success' })
  })

  it('reads a merge request pipeline through the checks interface', async () => {
    const c = commands({ gitlabPages: vi.fn(async () => rawJobs) })
    const read = await gitlabChecks.read(c, { ref: { kind: 'change', number: 7 }, state: 'open', url: '', authorId: 'a', sameProject: true,
      pipeline: { id: 3, status: 'failed' } })
    expect(read).toMatchObject({ status: 'failed', jobs: expect.arrayContaining([expect.objectContaining({ name: 'test', allowFailure: false })]) })
    expect(gitlabChecks.summary(read, 'MR !7', 'gitlab/merge_requests/7/pipelines')).toContain('failed 1/4')
  })

  it('reads a repository file and directory, rejecting hidden paths', async () => {
    const c = commands()
    expect(await readRepositoryPath(c, 'src/a.ts', 'file')).toBe('file body')
    expect(await readRepositoryPath(c, 'src', 'directory')).toBe('src')
    await expect(readRepositoryPath(c, '.env', 'file')).rejects.toThrow('non-hidden')
    await expect(gitlabRepositoryRead.read(c, 'src/a.ts', 'file')).resolves.toBe('file body')
  })

  it('gives assessments the notes around a Trigger by note id', async () => {
    const trigger = { id: 't', source: 'gitlab', threads: [{ source: 'gitlab', id: 'mr:7' }], actor: { source: 'gitlab', id: 'alice' },
      human: true, at: '', text: '', meta: { item: 'mr', iid: 7, noteId: 2 } } as Trigger
    const thread = await gitlabThreadContext.read(commands(), trigger, 'thread', undefined, {})
    expect(thread.messages.map(message => message.id)).toEqual(['1', '2'])
    expect(thread.next).toBeUndefined()
    const parent = await gitlabThreadContext.read(commands(), trigger, 'parent', undefined, {})
    expect(parent.messages.map(message => message.id)).toEqual(['1'])
    expect(gitlabThreadContext.messageId(trigger)).toBe('2')
  })

  it('builds MR and default-branch pipeline Triggers with distinct ids', () => {
    const mr = { id: 1, iid: 7, title: 'Fix', state: 'open', created_at: '', web_url: 'https://gitlab.example.com/group/app/-/merge_requests/7',
      author: { id: 1, username: 'alice' } }
    expect(mergeRequestPipelineTrigger(mr, 1, 'Pipeline running').meta).toMatchObject({ item: 'mr', iid: 7, event: 'ci', revision: 1 })
    expect(branchPipelineTrigger('main', 'abc', 1, 'Pipeline failed', 'https://gitlab.example.com/group/app/-/pipelines/1').threads)
      .toEqual([{ source: 'gitlab', id: 'ci:main' }])
  })
})
