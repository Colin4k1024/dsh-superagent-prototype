/** Contract of the GitLab kind skeleton: configuration, fields, ForgePort parsing and environment values. */
import { describe, expect, it } from 'vitest'
import { gitlabKind, gitlabForge, gitlabPage, itemThread } from '../src/sources/gitlab.ts'
import { testDeployment } from './fixtures/deployment.ts'

const gitlabDeployment = testDeployment({
  github: { cli: '', login: '', noreply: '' },
  forge: { kind: 'gitlab', repository: 'group/app', cli: '/opt/glab', login: 'agent-bot', commitEmail: 'agent@example.com',
    host: 'https://gitlab.example.com', projectId: 42 },
  gitlab: { host: 'https://gitlab.example.com', project: 'group/app', projectId: 42, cli: '/opt/glab', login: 'agent-bot', commitEmail: 'agent@example.com' },
})

describe('GitLab kind', () => {
  it('fills defaults that receive nothing until a project and glab are configured', () => {
    expect(gitlabKind.schema.parse({})).toMatchObject({ host: 'https://gitlab.com', project: '', cli: '', commitEmail: '',
      pollSeconds: 60, failuresBeforeError: 3, observeIssues: false, observeMrs: false, observeComments: false, observeCi: false,
      autoLabels: ['agent-ready'] })
    expect(gitlabKind.fields.map(field => field.key)).toEqual(expect.arrayContaining(['host', 'project', 'cli', 'commitEmail', 'autoLabels']))
    expect(gitlabKind.health).toEqual(['gitlab'])
    expect(gitlabKind.capabilities?.forge).toBe(gitlabForge)
    expect(gitlabKind.scope!({ meta: {} }, gitlabKind.schema.parse({}))).toEqual({ listened: true, observed: false })
    const observing = gitlabKind.schema.parse({ observeIssues: true, autoLabels: ['agent-ready'] })
    expect(gitlabKind.scope!({ meta: { item: 'issue', event: 'body', labels: ['agent-ready'] } }, observing)).toEqual({ listened: true, observed: true, row: 'issues' })
    expect(gitlabKind.scope!({ meta: { item: 'issue', event: 'body', labels: ['other'] } }, observing)).toEqual({ listened: true, observed: false, row: 'issues' })
    expect(gitlabKind.scope!({ meta: { item: 'issue', event: 'body' } }, observing)).toEqual({ listened: true, observed: false, row: 'issues' })
  })

  it('keeps issue and merge-request iids apart and reads only merge requests as changes', () => {
    expect(itemThread('issue', 7)).toBe('issue:7')
    expect(itemThread('mr', 7)).toBe('mr:7')
    expect(gitlabForge.change.parse('gitlab:mr:7')).toEqual({ kind: 'change', number: 7 })
    expect(gitlabForge.change.parse('gitlab:issue:7')).toBeUndefined()
    expect(gitlabForge.change.numbersOf({ follows: [{ thread: 'gitlab:mr:7', own: true }, { thread: 'gitlab:issue:3', own: true }] })).toEqual([7])
    expect(gitlabPage('https://gitlab.example.com/', 'group/app', 'mr', 7)).toBe('https://gitlab.example.com/group/app/-/merge_requests/7')
    expect(gitlabForge.pageUrl('group/app', { kind: 'change', number: 7 }, 'https://gitlab.example.com/')).toBe('https://gitlab.example.com/group/app/-/merge_requests/7')
  })

  it('registers the GitLab account and the ticket item in the execution environment', () => {
    const config = gitlabKind.schema.parse({ project: 'group/app', cli: '/opt/glab' })
    const trigger = { id: 't', source: 'gitlab', threads: [{ source: 'gitlab', id: 'mr:7' }], actor: { source: 'gitlab', id: 'alice' }, human: true,
      at: '2026-09-09T00:00:00Z', text: 'fix', meta: { item: 'mr', iid: 7 } }
    expect(gitlabKind.environment!.values({ deployment: gitlabDeployment, config, trigger })).toEqual({
      DSH_SUPERAGENT_GITLAB_HOST: 'https://gitlab.example.com', DSH_SUPERAGENT_GITLAB_PROJECT: 'group/app',
      DSH_SUPERAGENT_GITLAB_ACCOUNT: 'agent-bot', DSH_SUPERAGENT_GITLAB_COMMIT_EMAIL: 'agent@example.com',
      DSH_SUPERAGENT_GITLAB_ITEM: 'mr:7', DSH_SUPERAGENT_GITLAB_MR_HEAD: 'refs/merge-requests/7/head' })
  })
})
