#!/usr/bin/env node
/**
 * Live GitLab mention canary: post a uniquely tagged @mention on a dedicated Issue and wait for the agent's reply.
 *
 * It uses the operator's `glab` to post and read; it never uses the agent account to write. Keep the canary Issue
 * dedicated: every run adds a note and the agent replies in the same thread.
 *
 * Usage:
 *   node scripts/gitlab-mention-canary.mjs --host https://gitlab.example.com --project group/app --issue 123 --runs 20
 */
import { execFileSync } from 'node:child_process'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function parse(argv) {
  const value = { host: process.env.DSH_SUPERAGENT_GITLAB_HOST ?? 'https://gitlab.com', project: process.env.DSH_SUPERAGENT_GITLAB_PROJECT ?? '',
    issue: '', agent: process.env.DSH_SUPERAGENT_GITLAB_ACCOUNT ?? 'agent-bot', runs: 1, timeout: 120, interval: 5, glab: 'glab', dryRun: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--dry-run') { value.dryRun = true; continue }
    if (!flag.startsWith('--')) throw new Error(`Unknown argument: ${flag}`)
    const name = flag.slice(2)
    const next = argv[index + 1]
    if (next === undefined) throw new Error(`--${name} needs a value`)
    index += 1
    if (name === 'host') value.host = next
    else if (name === 'project') value.project = next
    else if (name === 'issue') value.issue = next
    else if (name === 'agent') value.agent = next
    else if (name === 'runs') value.runs = Number(next)
    else if (name === 'timeout') value.timeout = Number(next)
    else if (name === 'interval') value.interval = Number(next)
    else if (name === 'glab') value.glab = next
    else throw new Error(`Unknown option: --${name}`)
  }
  if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/.test(value.project)) throw new Error('--project group/subgroup/project is required')
  if (!/^\d+$/.test(value.issue)) throw new Error('--issue IID is required')
  if (!/^https?:\/\//.test(value.host)) throw new Error('--host https://gitlab.example.com is required')
  for (const key of ['runs', 'timeout', 'interval']) if (!Number.isFinite(value[key]) || value[key] <= 0) throw new Error(`--${key} must be positive`)
  return value
}

function glab(value, args) {
  return execFileSync(value.glab, ['api', ...args, '--hostname', new URL(value.host).host], { encoding: 'utf8' })
}
const projectPath = value => `projects/${encodeURIComponent(value.project)}`
const comment = (value, run) => {
  const token = `canary-${Date.now()}-${run}`
  return { token, body: `@${value.agent} mention-canary ${token}\n\n<!-- dsh-superagent-mention-canary:${token} -->\n\nReply "收到" only.` }
}

async function one(value, run) {
  const { token, body } = comment(value, run)
  if (value.dryRun) return { run, planned: true, body }
  const posted = JSON.parse(glab(value, [`${projectPath(value)}/issues/${value.issue}/notes`, '--method', 'POST', '-f', `body=${body}`]))
  const postedAt = Date.parse(posted.created_at)
  const deadline = Date.now() + value.timeout * 1000
  while (Date.now() < deadline) {
    const notes = JSON.parse(glab(value, [`${projectPath(value)}/issues/${value.issue}/notes?per_page=100&sort=desc`]))
    for (const note of notes) {
      if (note.author?.username !== value.agent) continue
      if (Date.parse(note.created_at ?? '') < postedAt) continue
      // The agent's outbound messages carry a hidden marker; a human quote of the canary does not.
      if (!(note.body ?? '').includes('dsh-superagent:')) continue
      return { run, token, captured: true, latencyMs: Date.now() - postedAt, note: note.created_at }
    }
    await sleep(value.interval * 1000)
  }
  return { run, token, captured: false, latencyMs: Date.now() - postedAt }
}

function percentile(values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]
}

async function main() {
  const value = parse(process.argv.slice(2))
  const results = []
  for (let run = 1; run <= value.runs; run += 1) {
    const result = await one(value, run)
    results.push(result)
    const status = result.planned ? 'planned' : result.captured ? `captured in ${result.latencyMs}ms` : 'MISSED'
    console.log(`run ${run}/${value.runs}: ${status}`)
  }
  if (value.dryRun) {
    console.log(JSON.stringify({ project: value.project, issue: value.issue, runs: value.runs, results }, null, 2))
    return
  }
  const latencies = results.filter(result => result.captured).map(result => result.latencyMs)
  const summary = { project: value.project, issue: value.issue, runs: value.runs, captured: latencies.length,
    missed: results.length - latencies.length, p95Ms: percentile(latencies, 0.95), maxMs: latencies.length ? Math.max(...latencies) : null,
    target: { capture: '20/20', p95Ms: 120_000 }, results }
  console.log(JSON.stringify(summary, null, 2))
  if (summary.missed > 0 || (summary.p95Ms !== null && summary.p95Ms > summary.target.p95Ms)) process.exitCode = 1
}

main().catch(error => { console.error(error.message ?? error); process.exitCode = 1 })
