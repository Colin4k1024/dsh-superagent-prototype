#!/usr/bin/env python3
"""Point the local superagent-gitlab profile at the internal GitLab (hgit.haier.net).

Requires the corporate network/VPN, an existing `glab` host configuration for hgit.haier.net, and:
  GITLAB_PROJECT=group/subgroup/project
Optional:
  GITLAB_HOST (default https://hgit.haier.net)
  GITLAB_CLI (default: the glab on PATH)
  GITLAB_MERGE_CLI (a separate Maintainer glab wrapper; leave unset to keep human-only merging)
  GITLAB_COMMIT_EMAIL (default <glab user>@users.noreply.<host>)
  GITLAB_ALLOWED (comma-separated usernames allowed to originate work; default: the glab user)
"""
import json, os, shutil, subprocess, sys, urllib.parse, urllib.request

HOST = os.environ.get('GITLAB_HOST', 'https://hgit.haier.net').rstrip('/')
PROJECT = os.environ.get('GITLAB_PROJECT', '').strip()
CLI = os.environ.get('GITLAB_CLI') or shutil.which('glab') or ''
MERGE = os.environ.get('GITLAB_MERGE_CLI', '').strip()
BASE = os.environ.get('GITLAB_BASE', 'http://127.0.0.1:3083').rstrip('/')
HOST_HEADER = urllib.parse.urlparse(BASE).netloc or '127.0.0.1:3083'
HEADERS = {'Host': HOST_HEADER, 'X-Orchestrator-Request': '1', 'Origin': BASE, 'content-type': 'application/json'}

def fail(message):
    print(f'error: {message}', file=sys.stderr); sys.exit(1)

if not PROJECT or not PROJECT.startswith(('http://', 'https://')) and PROJECT.count('/') < 1:
    fail('set GITLAB_PROJECT=group/subgroup/project')
if not CLI:
    fail('glab is not on PATH')

host = urllib.parse.urlparse(HOST).hostname or HOST
encoded = urllib.parse.quote(PROJECT, safe='')
try:
    info = subprocess.run([CLI, 'api', f'projects/{encoded}', '--hostname', host], check=True, capture_output=True, text=True, timeout=20)
    project = json.loads(info.stdout)
except Exception as error:
    detail = getattr(error, 'stderr', '') or str(error)
    fail(f'cannot reach {HOST} as glab user (connect the corporate VPN first):\n{detail.strip()}')
try:
    who = json.loads(subprocess.run([CLI, 'api', 'user', '--hostname', host], check=True, capture_output=True, text=True, timeout=20).stdout)
except Exception as error:
    fail(f'cannot read the glab user: {error}')
access = ((project.get('permissions') or {}).get('project_access') or {}).get('access_level')
if access is not None and access < 30:
    fail(f'{who.get("username")} has access level {access} on {PROJECT}; Developer (30) or higher is required')

email = os.environ.get('GITLAB_COMMIT_EMAIL') or f'{who.get("username")}@users.noreply.{host}'
allowed = [name.strip() for name in os.environ.get('GITLAB_ALLOWED', who.get('username', '')).split(',') if name.strip()]

def call(method, path, body=None):
    request = urllib.request.Request(BASE + path, method=method, headers=HEADERS,
        data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())
    except Exception as error:
        fail(f'{method} {path} failed (is the superagent-gitlab profile on {BASE}?): {error}')

settings = call('GET', '/orchestrator/api/settings')
source = next((item for item in settings['sources'] if item['id'] == 'gitlab'), None)
if not source:
    fail('the profile has no GitLab Source installed')
config = dict(source['value']['config'])
config.update({'host': HOST, 'project': PROJECT, 'cli': CLI, 'commitEmail': email,
    'mergeCli': MERGE, 'pollSeconds': 60, 'observeIssues': True, 'observeMrs': True,
    'observeComments': True, 'observeCi': True, 'autoLabels': ['agent-ready']})
saved = call('PUT', '/orchestrator/api/settings/source:gitlab', {'value': {'enabled': True, 'config': config}, 'revision': source['revision']})
print('source saved:', saved)

settings = call('GET', '/orchestrator/api/settings')
policy = settings['blocks']['policy']
value = json.loads(json.dumps(policy['value']))
value.setdefault('sources', {})['gitlab'] = {'allowed': [{'id': name} for name in allowed], 'bots': []}
saved = call('PUT', '/orchestrator/api/settings/policy', {'value': value, 'revision': policy['revision']})
print('policy saved:', saved)
print(f'target: {HOST} / {PROJECT}; agent: {who.get("username")}; allowed: {", ".join(allowed)}; mergeCli: {MERGE or "(human only)"}')
