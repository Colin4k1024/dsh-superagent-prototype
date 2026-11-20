import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, '..', 'scripts/mention-canary.mjs')

describe('mention canary', () => {
  it('plans the requested runs without touching GitHub in dry-run mode', () => {
    const output = execFileSync(process.execPath, [SCRIPT, '--repo', 'acme/widgets', '--issue', '42', '--runs', '2', '--dry-run'],
      { encoding: 'utf8' })
    const summary = JSON.parse(output.slice(output.indexOf('{')))
    expect(summary).toMatchObject({ repo: 'acme/widgets', issue: '42', runs: 2 })
    expect(summary.results).toHaveLength(2)
    expect(summary.results[0].body).toContain('@xiangzi-agent mention-canary')
    expect(summary.results[0].body).toContain('dsh-superagent-mention-canary')
  })
})
