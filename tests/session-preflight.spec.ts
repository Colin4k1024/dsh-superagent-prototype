import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = join(ROOT, 'scripts/session-preflight.py')
const PYTHON = process.env.PYTHON ?? 'python3'
const hasZstd = (() => {
  try { execFileSync('zstd', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
})()

describe('session preflight', () => {
  let home: string
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'session-preflight-')) })
  afterEach(() => { rmSync(home, { recursive: true, force: true }) })

  it('quarantines backup directories before DSH can scan them, and leaves a real session alone', () => {
    const profile = join(home, 'sessions', '--profile--')
    const backup = join(profile, '.bak-123')
    const valid = join(profile, 'worker-abc')
    mkdirSync(backup, { recursive: true }); mkdirSync(valid, { recursive: true })
    writeFileSync(join(valid, 'session.v4.jsonl.zstd'), '')
    const output = execFileSync(PYTHON, [SCRIPT, '--home', home], { encoding: 'utf8' })
    const result = JSON.parse(output.trim().split('\n').at(-1)!)
    expect(result.moved).toEqual([expect.objectContaining({ session: '.bak-123', reason: 'backup-or-temporary' })])
    expect(existsSync(backup)).toBe(false)
    expect(existsSync(valid)).toBe(true)
    const quarantined = join(home, 'session-quarantine')
    expect(existsSync(quarantined)).toBe(true)
  })

  it('quarantines a session whose header id does not match its directory, when zstd is available', () => {
    if (!hasZstd) return
    const profile = join(home, 'sessions', '--profile--')
    const corrupt = join(profile, 'worker-expected')
    mkdirSync(corrupt, { recursive: true })
    const raw = join(home, 'header.jsonl')
    writeFileSync(raw, JSON.stringify({ type: 'session', version: 4, id: 'worker-other', cwd: '/w' }) + '\n')
    execFileSync('zstd', ['-q', '-f', raw, '-o', join(corrupt, 'session.v4.jsonl.zstd')])
    const output = execFileSync(PYTHON, [SCRIPT, '--home', home], { encoding: 'utf8' })
    const result = JSON.parse(output.trim().split('\n').at(-1)!)
    expect(result.moved).toEqual([expect.objectContaining({ session: 'worker-expected', reason: 'header-id-mismatch' })])
    expect(existsSync(corrupt)).toBe(false)
  })

  it('reports what it would move on a dry run without moving it', () => {
    const profile = join(home, 'sessions', '--profile--')
    const backup = join(profile, '.bak-456')
    mkdirSync(backup, { recursive: true })
    const output = execFileSync(PYTHON, [SCRIPT, '--home', home, '--dry-run'], { encoding: 'utf8' })
    const result = JSON.parse(output.trim().split('\n').at(-1)!)
    expect(result.moved).toHaveLength(1)
    expect(existsSync(backup)).toBe(true)
  })
})
