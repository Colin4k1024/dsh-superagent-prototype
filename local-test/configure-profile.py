#!/usr/bin/env python3
"""Configure the local superagent-gitlab profile to use the fake GitLab API."""
import json, pathlib, urllib.request

BASE = 'http://127.0.0.1:3083'
HEADERS = {'Host': '127.0.0.1:3083', 'X-Orchestrator-Request': '1', 'Origin': BASE, 'content-type': 'application/json'}
ROOT = pathlib.Path(__file__).resolve().parent
GLAB = str(ROOT / 'gitlab-fake/bin/glab')

def call(method, path, body=None):
    request = urllib.request.Request(BASE + path, method=method, headers=HEADERS,
        data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())

settings = call('GET', '/orchestrator/api/settings')
source = next(s for s in settings['sources'] if s['id'] == 'gitlab')
config = dict(source['value']['config'])
config.update({'host': 'http://127.0.0.1:8929', 'project': 'group/app', 'cli': GLAB,
    'commitEmail': 'dsh-agent@example.com', 'mergeCli': GLAB, 'pollSeconds': 60,
    'observeIssues': True, 'observeMrs': True, 'observeComments': True, 'observeCi': False,
    'autoLabels': ['agent-ready']})
saved = call('PUT', '/orchestrator/api/settings/source:gitlab', {'value': {'enabled': True, 'config': config}, 'revision': source['revision']})
print('source saved:', saved)

settings = call('GET', '/orchestrator/api/settings')
policy = settings['blocks']['policy']
value = json.loads(json.dumps(policy['value']))
sources = value.setdefault('sources', {})
sources['gitlab'] = {'allowed': [{'id': 'alice'}], 'bots': []}
saved = call('PUT', '/orchestrator/api/settings/policy', {'value': value, 'revision': policy['revision']})
print('policy saved:', saved)
