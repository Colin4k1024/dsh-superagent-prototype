/** Contract of the GitLab Channel: project-scoped paths, marker idempotency, discussion replies and gone/retry answers. */
import { describe, expect, it, vi } from 'vitest'
import { CliError, Commands } from '../src/infra/commands.ts'
import { sendGitlab } from '../src/sources/gitlab-channel.ts'
import type { OutboundMessage } from '../src/core/index.ts'
import { testDeployment } from './fixtures/deployment.ts'

const deployment = testDeployment({
  github: { cli: '', login: '', noreply: '' },
  forge: { kind: 'gitlab', repository: 'group/app', cli: '/path/glab', login: 'agent-bot', commitEmail: '', host: 'https://gitlab.example.com', projectId: 42 },
  gitlab: { host: 'https://gitlab.example.com', project: 'group/app', projectId: 42, cli: '/path/glab', login: 'agent-bot', commitEmail: '' },
})
const message = (id = 'r1', address: Record<string, string> = { kind: 'mr', iid: '7' }): OutboundMessage =>
  ({ id, channel: { source: 'gitlab', thread: 'gitlab:mr:7', address }, text: 'Done', kind: 'reply' })
const host = () => {
  const commands = new Commands(() => deployment, {}, new AbortController().signal)
  const run = vi.spyOn(commands, 'run')
  return { commands, run }
}

describe('GitLab Channel', () => {
  it('posts a note once under the project and keeps a marker for retries', async () => {
    const { commands, run } = host()
    run.mockResolvedValueOnce('[]').mockResolvedValueOnce('{}')
    await expect(sendGitlab({ commands }, message())).resolves.toBe('sent')
    expect(run.mock.calls[1]![1]).toEqual(['api', 'projects/42/merge_requests/7/notes', '--method', 'POST', '-f',
      expect.stringContaining('<!-- dsh-superagent:r1 -->')])
  })

  it('returns sent without posting when the marker is already there', async () => {
    const { commands, run } = host()
    run.mockResolvedValueOnce(JSON.stringify([{ id: 1, body: '<!-- dsh-superagent:r1 -->', author: { id: 2, username: 'agent-bot' } }]))
    await expect(sendGitlab({ commands }, message())).resolves.toBe('sent')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('replies in a discussion when the address names one', async () => {
    const { commands, run } = host()
    run.mockResolvedValueOnce('[]').mockResolvedValueOnce('{}')
    await sendGitlab({ commands }, message('r1', { kind: 'mr', iid: '7', discussionId: 'disc-1' }))
    expect(run.mock.calls[1]![1][1]).toBe('projects/42/merge_requests/7/discussions/disc-1/notes')
  })

  it('falls back to the MR conversation when a discussion cannot be replied to', async () => {
    const { commands, run } = host()
    run.mockResolvedValueOnce('[]').mockRejectedValueOnce(new CliError('system note', 400)).mockResolvedValueOnce('{}')
    await expect(sendGitlab({ commands }, message('r1', { kind: 'mr', iid: '7', discussionId: 'system' }))).resolves.toBe('sent')
    expect(run.mock.calls[2]![1][1]).toBe('projects/42/merge_requests/7/notes')
  })

  it('answers gone for a deleted target and throws for a retryable failure', async () => {
    const first = host()
    first.run.mockResolvedValueOnce('[]').mockRejectedValueOnce(new CliError('gone', 404))
    await expect(sendGitlab({ commands: first.commands }, message())).resolves.toBe('gone')
    const second = host()
    second.run.mockResolvedValueOnce('[]').mockRejectedValueOnce(new CliError('rate limited', 429))
    await expect(sendGitlab({ commands: second.commands }, message())).rejects.toThrow('rate limited')
  })

  it('escapes a line-leading quick action so it is not executed', async () => {
    const { commands, run } = host()
    run.mockResolvedValueOnce('[]').mockResolvedValueOnce('{}')
    await sendGitlab({ commands }, { ...message(), text: '/close\nDone' })
    expect(String(run.mock.calls[1]![1][5])).toContain('\u200b/close')
  })
})
