#!/usr/bin/env node
/** Minimal glab shim: `glab api <path> [--method METHOD] [-f k=v] [--paginate] [--hostname host]`. */
const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === 'version') { console.log('glab 0.0.0-local-fixture'); process.exit(0) }
if (args[0] !== 'api') { console.error(`glab shim: unsupported command: ${args.join(' ')}`); process.exit(1) }
const base = process.env.DSH_FAKE_GITLAB ?? 'http://127.0.0.1:8929'
let path = '', method = '', fields = {}, paginate = false
for (let i = 1; i < args.length; i += 1) {
  const arg = args[i]
  if (arg === '--method' || arg === '-X') { method = args[++i]?.toUpperCase() ?? ''; continue }
  if (arg === '-f' || arg === '--field' || arg === '--raw-field' || arg === '-F') { const [k, ...v] = (args[++i] ?? '').split('='); fields[k] = v.join('='); continue }
  if (arg === '--paginate') { paginate = true; continue }
  if (arg === '--hostname' || arg === '--output') { i += 1; continue }
  if (!arg.startsWith('-') && !path) { path = arg; continue }
}
const url = new URL(`/api/v4/${path}`, base)
const init = { method: method || (Object.keys(fields).length ? 'POST' : 'GET'), headers: { 'PRIVATE-TOKEN': 'local', 'content-type': 'application/json', 'X-Fake-User': process.env.DSH_FAKE_USER ?? 'dsh-agent' } }
if (Object.keys(fields).length) init.body = JSON.stringify(fields)
const response = await fetch(url, init)
const text = await response.text()
if (!response.ok) { console.error(text); process.exit(1) }
try { console.log(JSON.stringify(JSON.parse(text), null, 2)) } catch { process.stdout.write(text) }
