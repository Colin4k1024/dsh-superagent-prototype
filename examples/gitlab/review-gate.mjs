#!/usr/bin/env node
/**
 * Review gate for merge requests opened by coding agents.
 *
 * A normal MR needs one approval. An MR above `maxLines` additions+deletions, or one touching a sensitive path, needs
 * two. The author's own approval never counts. This file is standalone so it can be copied to `.gitlab/scripts/review-gate.mjs`
 * in a target repository; it uses only Node's built-in `fetch` and has no dependencies.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DEFAULTS = {
  maxLines: 200,
  sensitivePaths: [
    '**/auth/**', '**/oauth/**', '**/audit/**', '**/policy/**', '**/approval/**',
    '**/isolation/**', '**/binding*', '**/migrations/**', '**/*secret*', '**/*credential*',
  ],
}

/** True when a repository path matches a small glob: `**` spans directories, `*` stays in one segment, `?` is one character. */
export function matchPath(pattern, file) {
  if (pattern === file) return true
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        index += 1
        if (pattern[index + 1] === '/') { index += 1; source += '(?:.*/)?' } else source += '.*'
      } else source += '[^/]*'
    } else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`).test(file)
}

/** The approvals GitLab reports, excluding the MR author; GitLab approvals have no per-review stale state. */
export function approversOf(approvals, author) {
  const names = (approvals?.approved_by ?? []).map(item => item.user?.username ?? item.username).filter(Boolean)
  return [...new Set(names.map(name => String(name).toLowerCase()))].filter(name => name !== String(author ?? '').toLowerCase())
}

/** The diff size and paths of a GitLab `/changes` payload. */
export function changeStats(changes) {
  let lines = 0
  const files = []
  for (const change of changes ?? []) {
    files.push(change.new_path ?? change.old_path)
    for (const line of String(change.diff ?? '').split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) lines += 1
      else if (line.startsWith('-') && !line.startsWith('---')) lines += 1
    }
  }
  return { lines, files: files.filter(Boolean) }
}

/** Decide whether an MR passes the review gate. Pure: the same inputs always produce the same result. */
export function evaluateGitlabReviewGate({ author, draft = false, changes = [], approvals = {} }, config = {}) {
  const settings = { ...DEFAULTS, ...config }
  const { lines, files } = changeStats(changes)
  const sensitive = files.filter(file => settings.sensitivePaths.some(pattern => matchPath(pattern, file)))
  const large = lines > settings.maxLines
  const required = large || sensitive.length > 0 ? 2 : 1
  const approvalsFound = approversOf(approvals, author)
  const passed = !draft && approvalsFound.length >= required
  const reasons = [
    draft ? 'the MR is a draft' : 'not a draft',
    passed ? 'enough approvals' : `needs ${required} approval${required === 1 ? '' : 's'}`,
    `${approvalsFound.length} approval${approvalsFound.length === 1 ? '' : 's'} from someone other than the author`,
    large ? `${lines} changed lines > ${settings.maxLines}` : `${lines} changed lines`,
    ...(sensitive.length ? [`sensitive paths: ${sensitive.slice(0, 5).join(', ')}${sensitive.length > 5 ? ', …' : ''}`] : []),
  ]
  return { passed, required, approvals: approvalsFound, lines, large, sensitive, draft, reason: reasons.join('; ') }
}

/** The GitLab API root, from CI first so a self-managed instance works without extra configuration. */
export const apiUrl = (env = process.env) => `${(env.CI_API_V4_URL ?? `${env.GITLAB_URL ?? 'https://gitlab.com'}/api/v4`).replace(/\/+$/, '')}`

async function gitlab(env, path) {
  const response = await fetch(`${apiUrl(env)}${path}`, { headers: { 'PRIVATE-TOKEN': env.GITLAB_TOKEN ?? '', Accept: 'application/json' } })
  if (!response.ok) throw new Error(`GitLab ${path}: ${response.status} ${response.statusText}`)
  return response.json()
}

async function main() {
  const env = process.env
  const project = env.CI_PROJECT_ID
  const number = env.CI_MERGE_REQUEST_IID
  if (!env.GITLAB_TOKEN || !project || !number) throw new Error('GITLAB_TOKEN, CI_PROJECT_ID and CI_MERGE_REQUEST_IID are required')
  const configPath = env.REVIEW_GATE_CONFIG || '.gitlab/review-gate.json'
  let config = {}
  try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const [mr, changes, approvals] = await Promise.all([
    gitlab(env, `/projects/${project}/merge_requests/${number}`),
    gitlab(env, `/projects/${project}/merge_requests/${number}/changes`),
    gitlab(env, `/projects/${project}/merge_requests/${number}/approvals`).catch(() => ({ approved_by: [] })),
  ])
  const result = evaluateGitlabReviewGate({ author: mr.author?.username, draft: !!mr.draft, changes: changes.changes, approvals }, config)
  console.log(JSON.stringify({ number: Number(number), ...result }, null, 2))
  if (!result.passed) {
    console.error(`review-gate failed: ${result.reason}`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
