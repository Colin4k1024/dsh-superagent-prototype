#!/usr/bin/env node
/** A tiny GitLab API fixture for local dsh-superagent testing (no Git transport). */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8929)
const now = () => new Date().toISOString()
const users = {
  1: { id: 1, username: 'dsh-agent', name: 'DSH Agent', bot: false, state: 'active' },
  2: { id: 2, username: 'alice', name: 'Alice', bot: false, state: 'active' },
  3: { id: 3, username: 'dsh-reviewer', name: 'DSH Reviewer', bot: false, state: 'active' },
}
const project = { id: 42, path_with_namespace: 'group/app', name: 'app', default_branch: 'main', archived: false,
  permissions: { project_access: { access_level: 30 }, group_access: null },
  web_url: `http://127.0.0.1:${PORT}/group/app` }
const issues = new Map()
const notes = new Map() // "issue:7" -> array
const mrs = new Map()
const approvals = new Map()
const discussions = new Map()
let nextNote = 100
const seed = (iid, title, body, author = users[2]) => {
  const issue = { id: 1000 + iid, iid, title, description: body, state: 'opened', created_at: now(), updated_at: now(),
    web_url: `http://127.0.0.1:${PORT}/group/app/-/issues/${iid}`, author, labels: ['agent-ready'] }
  issues.set(iid, issue); notes.set(`issue:${iid}`, []); return issue
}
seed(7, 'Local fixture issue', 'Reply with a short acknowledgement; this is the local fake GitLab.')

const readBody = req => new Promise(resolve => { let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => resolve(body)) })
const parseBody = (req, raw) => {
  const type = req.headers['content-type'] ?? ''
  if (type.includes('application/json')) { try { return JSON.parse(raw || '{}') } catch { return {} } }
  return Object.fromEntries(new URLSearchParams(raw))
}
const user = req => users[{ 'alice': 2, 'dsh-reviewer': 3, 'dsh-agent': 1 }[String(req.headers['x-fake-user'] ?? 'dsh-agent')] ?? 1]
const noteAuthor = req => user(req)
const note = (iid, body, author) => ({ id: nextNote++, body, author, created_at: now(), updated_at: now(), system: false,
  noteable_type: 'Issue', noteable_iid: iid, type: null })
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const notFound = res => json(res, 404, { message: '404 Not Found' })

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = decodeURIComponent(url.pathname.replace(/^\/api\/v4\/?/, ''))
  const method = req.method ?? 'GET'
  const body = parseBody(req, await readBody(req))
  if (path === 'user') return json(res, 200, user(req))
  if (path === 'todos') return json(res, 200, [])
  if (path === 'projects/42' || path === 'projects/group/app') return json(res, 200, project)
  if (path === 'projects/42/events' || path === 'projects/group/app/events') return json(res, 200, [])
  let m
  if ((m = /^projects\/(?:42|group\/app)\/issues$/.exec(path))) return json(res, 200, [...issues.values()])
  if ((m = /^projects\/(?:42|group\/app)\/issues\/(\d+)$/.exec(path))) {
    const issue = issues.get(Number(m[1])); return issue ? json(res, 200, issue) : notFound(res)
  }
  if ((m = /^projects\/(?:42|group\/app)\/issues\/(\d+)\/notes$/.exec(path))) {
    const iid = Number(m[1]); const list = notes.get(`issue:${iid}`) ?? []
    if (method === 'POST') { const created = note(iid, body.body ?? '', noteAuthor(req)); list.push(created); notes.set(`issue:${iid}`, list); return json(res, 201, created) }
    return json(res, 200, [...list].sort((a, b) => b.id - a.id))
  }
  if ((m = /^projects\/(?:42|group\/app)\/issues\/(\d+)\/discussions$/.exec(path))) return json(res, 200, discussions.get(`issue:${Number(m[1])}`) ?? [])
  if ((m = /^projects\/(?:42|group\/app)\/merge_requests$/.exec(path))) return json(res, 200, [...mrs.values()])
  if ((m = /^projects\/(?:42|group\/app)\/merge_requests\/(\d+)$/.exec(path))) {
    const mr = mrs.get(Number(m[1])); return mr ? json(res, 200, mr) : notFound(res)
  }
  if ((m = /^projects\/(?:42|group\/app)\/merge_requests\/(\d+)\/notes$/.exec(path))) return json(res, 200, [])
  if ((m = /^projects\/(?:42|group\/app)\/merge_requests\/(\d+)\/discussions$/.exec(path))) return json(res, 200, [])
  if ((m = /^projects\/(?:42|group\/app)\/merge_requests\/(\d+)\/approvals$/.exec(path))) return json(res, 200, approvals.get(Number(m[1])) ?? { approved_by: [], approvals_required: 0 })
  if ((m = /^projects\/(?:42|group\/app)\/merge_requests\/(\d+)\/changes$/.exec(path))) return json(res, 200, { changes: [] })
  if ((m = /^projects\/(?:42|group\/app)\/merge_requests\/(\d+)\/merge$/.exec(path))) {
    const mr = mrs.get(Number(m[1])); if (!mr) return notFound(res); mr.state = 'merged'; mr.merged_at = now(); return json(res, 200, mr)
  }
  if ((m = /^projects\/(?:42|group\/app)\/pipelines$/.exec(path))) return json(res, 200, [])
  if ((m = /^projects\/(?:42|group\/app)\/repository\/tree$/.exec(path))) return json(res, 200, [{ name: 'README.md' }, { name: 'src' }])
  if ((m = /^projects\/(?:42|group\/app)\/repository\/files\/(.+)\/raw$/.exec(path))) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('local fake repository\n') }
  return notFound(res)
})

server.listen(PORT, '127.0.0.1', () => console.log(`fake GitLab API on http://127.0.0.1:${PORT}`))
