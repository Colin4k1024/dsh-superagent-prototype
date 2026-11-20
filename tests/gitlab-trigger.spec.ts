/** Contract of GitLab Triggers: stable ids, typed Threads, actors, mentions and Channel addresses. */
import { describe, expect, it } from 'vitest'
import { approvalTrigger, gitlabAddress, gitlabChannel, isHumanUser, issueTrigger, mentions, mergeRequestTrigger, noteTrigger, SOURCE }
  from '../src/sources/gitlab-trigger.ts'

const user = (username: string, bot = false) => ({ id: 1, username, bot, state: 'active' })
const item = { id: 1, iid: 7, title: 'Fix the margin', description: '@agent-bot please fix it', state: 'opened',
  created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z', web_url: 'https://gitlab.example.com/group/app/-/issues/7',
  author: user('alice'), labels: ['agent-ready'] }
const mr = { ...item, web_url: 'https://gitlab.example.com/group/app/-/merge_requests/7', source_branch: 'agent/fix', target_branch: 'main',
  source_project_id: 42, target_project_id: 42, draft: false, sha: 'abc' }

describe('GitLab Triggers', () => {
  it('translates an Issue body into an issue Thread, keeping the actor and the mention', () => {
    const trigger = issueTrigger(item, 'agent-bot')
    expect(trigger).toMatchObject({ source: SOURCE, threads: [{ source: SOURCE, id: 'issue:7' }], actor: { source: SOURCE, id: 'alice' },
      human: true, addressed: 'mention', url: item.web_url, meta: { item: 'issue', iid: 7, labels: ['agent-ready'] } })
    expect(trigger.channel).toEqual(gitlabChannel('issue', 7, { url: item.web_url }))
    expect(trigger.text).toContain('@agent-bot please fix it')
  })

  it('translates an MR body into an mr Thread, which is distinct from the issue iid', () => {
    const trigger = mergeRequestTrigger(mr, 'agent-bot')
    expect(trigger).toMatchObject({ source: SOURCE, threads: [{ source: SOURCE, id: 'mr:7' }], actor: { source: SOURCE, id: 'alice' },
      addressed: 'mention', meta: { item: 'mr', iid: 7, sourceBranch: 'agent/fix', targetBranch: 'main', draft: false } })
    expect(trigger.id).not.toBe(issueTrigger(item, 'agent-bot').id)
  })

  it('translates a human note and a DiffNote, and skips system notes', () => {
    const note = { id: 11, body: '@agent-bot the button is still blue', author: user('bob'), created_at: '2026-09-09T00:01:00Z', system: false }
    const trigger = noteTrigger(note, { kind: 'mr', iid: 7, url: mr.web_url }, 'agent-bot', 'disc-1')!
    expect(trigger).toMatchObject({ source: SOURCE, threads: [{ source: SOURCE, id: 'mr:7' }], actor: { source: SOURCE, id: 'bob' },
      human: true, addressed: 'mention', channel: { source: SOURCE, thread: 'gitlab:mr:7',
        address: { kind: 'mr', iid: '7', noteId: '11', discussionId: 'disc-1' } }, meta: { event: 'note', noteId: 11, discussionId: 'disc-1' } })
    const diff = noteTrigger({ ...note, id: 12, type: 'DiffNote', position: { new_path: 'src/a.ts', new_line: 3 } },
      { kind: 'mr', iid: 7 }, 'agent-bot')
    expect(diff!.text).toContain('src/a.ts:3')
    expect(noteTrigger({ ...note, system: true }, { kind: 'mr', iid: 7 }, 'agent-bot')).toBeUndefined()
    // The agent's own note is not human.
    expect(noteTrigger({ ...note, author: user('agent-bot', true) }, { kind: 'mr', iid: 7 }, 'agent-bot')!.human).toBe(false)
  })

  it('synthesizes an approval Trigger without a body and parses a note URL', () => {
    expect(approvalTrigger(mr, user('carol'), '2026-09-09T00:02:00Z')).toMatchObject({ source: SOURCE,
      threads: [{ source: SOURCE, id: 'mr:7' }], actor: { source: SOURCE, id: 'carol' }, human: true, meta: { event: 'approval' } })
    expect(gitlabAddress('https://gitlab.example.com/group/app/-/merge_requests/7#note_11', 'https://gitlab.example.com/', 'group/app'))
      .toEqual({ kind: 'mr', iid: 7, noteId: 11 })
    expect(gitlabAddress('https://gitlab.com/other/app/-/issues/7', 'https://gitlab.example.com', 'group/app')).toBeUndefined()
  })

  it('recognizes people, bot users and mentions with GitLab usernames', () => {
    expect(isHumanUser(user('alice'))).toBe(true)
    expect(isHumanUser(user('project_42_bot', true))).toBe(false)
    expect(isHumanUser({ bot: false, state: 'blocked' })).toBe(false)
    expect(mentions('ping @agent.bot please', 'agent.bot')).toBe(true)
    expect(mentions('ping @agentXbot please', 'agent.bot')).toBe(false)
  })
})
