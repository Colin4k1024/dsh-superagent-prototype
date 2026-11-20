#!/usr/bin/env node
/**
 * Review gate for pull requests opened by coding agents.
 *
 * A normal PR needs one approval. A large PR (additions + deletions above `maxLines`) or one that touches a sensitive
 * path (auth, isolation, audit, policy, migrations, ...) needs two. The author's own approval never counts. The check is
 * intended to be a required status check on the protected default branch; see docs/009-review-gate.md.
 *
 * This file is standalone so it can be copied to `.github/scripts/review-gate.mjs` in a target repository. It uses only
 * Node's built-in `fetch` and has no dependencies.
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

/** Latest review state per user; `DISMISSED` and `COMMENTED` do not approve, and a later change request overrides an earlier approval. */
export function latestApprovals(reviews) {
  const state = new Map()
  for (const review of reviews ?? []) {
    const login = review.user?.login ?? review.login
    if (!login || review.state === 'PENDING') continue
    state.set(login.toLowerCase(), review.state)
  }
  return [...state].filter(([, value]) => value === 'APPROVED').map(([login]) => login)
}

/** Decide whether a PR passes the review gate. Pure: the same inputs always produce the same result. */
export function evaluateReviewGate(pull, reviews, config = {}) {
  const settings = { ...DEFAULTS, ...config }
  const files = pull.files ?? []
  const lines = Number(pull.additions ?? 0) + Number(pull.deletions ?? 0)
  const sensitive = files.filter(file => settings.sensitivePaths.some(pattern => matchPath(pattern, file)))
  const large = lines > settings.maxLines
  const required = large || sensitive.length > 0 ? 2 : 1
  const approvals = latestApprovals(reviews).filter(login => login !== String(pull.author ?? pull.user?.login ?? '').toLowerCase())
  const passed = approvals.length >= required
  const reasons = [
    passed ? 'enough approvals' : `needs ${required} approval${required === 1 ? '' : 's'}`,
    `${approvals.length} approval${approvals.length === 1 ? '' : 's'} from someone other than the author`,
    large ? `${lines} changed lines > ${settings.maxLines}` : `${lines} changed lines`,
    ...(sensitive.length ? [`sensitive paths: ${sensitive.slice(0, 5).join(', ')}${sensitive.length > 5 ? ', …' : ''}`] : []),
  ]
  return { passed, required, approvals, lines, large, sensitive, reason: reasons.join('; ') }
}

async function github(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-superagent-review-gate',
      'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!response.ok) throw new Error(`GitHub ${path}: ${response.status} ${response.statusText}`)
  return response.json()
}

async function all(path, token) {
  const values = []
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await github(`${path}${separator}per_page=100&page=${page}`, token)
    values.push(...batch)
    if (batch.length < 100) return values
  }
}

async function main() {
  const token = process.env.GITHUB_TOKEN
  const repository = process.env.GITHUB_REPOSITORY
  const number = process.env.PR_NUMBER
  if (!token || !repository || !number) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required')
  const configPath = process.env.REVIEW_GATE_CONFIG || '.github/review-gate.json'
  let config = {}
  try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const [pull, files, reviews] = await Promise.all([
    github(`/repos/${repository}/pulls/${number}`, token),
    all(`/repos/${repository}/pulls/${number}/files`, token),
    all(`/repos/${repository}/pulls/${number}/reviews`, token),
  ])
  const result = evaluateReviewGate({ author: pull.user?.login, additions: pull.additions, deletions: pull.deletions,
    files: files.map(file => file.filename) }, reviews, config)
  console.log(JSON.stringify({ number: Number(number), ...result }, null, 2))
  if (!result.passed) {
    console.error(`review-gate failed: ${result.reason}`)
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
