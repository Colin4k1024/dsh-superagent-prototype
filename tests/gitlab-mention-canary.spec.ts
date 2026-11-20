import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '..', 'scripts/gitlab-mention-canary.mjs')

describe('GitLab mention canary', () => {
  it('plans the requested runs without touching GitLab in dry-run mode', () => {
    const output = execFileSync(process.execPath, [SCRIPT, '--host', 'https://gitlab.example.com', '--project', 'group/app', '--issue', '42', '--runs', '2', '--dry-run'],
      { encoding: 'utf8' })
    const summary = JSON.parse(output.slice(output.indexOf('{')))
    expect(summary).toMatchObject({ project: 'group/app', issue: '42', runs: 2 })
    expect(summary.results).toHaveLength(2)
    expect(summary.results[0].body).toContain('@agent-bot mention-canary')
    expect(summary.results[0].body).toContain('dsh-superagent-mention-canary')
  })
})
