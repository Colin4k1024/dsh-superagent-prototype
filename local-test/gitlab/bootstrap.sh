#!/usr/bin/env bash
# Wait for the local GitLab, create users/tokens/project, seed the repo, then protect main.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="http://127.0.0.1:8929"
CONTAINER="dsh-gitlab"
CREDS="$ROOT/credentials.json"

echo "waiting for GitLab at $HOST ..."
for i in $(seq 1 120); do
  if curl -fsS "$HOST/-/readiness" >/dev/null 2>&1; then echo "ready"; break; fi
  sleep 5
  if [[ "$i" == 120 ]]; then echo "GitLab did not become ready" >&2; exit 1; fi
done

docker cp "$ROOT/bootstrap.rb" "$CONTAINER:/tmp/dsh-bootstrap.rb"
docker exec "$CONTAINER" gitlab-rails runner /tmp/dsh-bootstrap.rb > "$CREDS"
python3 - <<PY
import json
c=json.load(open("$CREDS"))
print("project:", c["project"], c["project_id"])
print("agent token:", c["agent"][:12] + "...")
PY

PROJECT_ID=$(python3 -c "import json;print(json.load(open('$CREDS'))['project_id'])")
ROOT_TOKEN=$(python3 -c "import json;print(json.load(open('$CREDS'))['root'])")
WORK="$ROOT/work"
rm -rf "$WORK"; mkdir -p "$WORK"
git -c credential.helper= clone "http://oauth2:$ROOT_TOKEN@127.0.0.1:8929/dsh-test/widgets.git" "$WORK"
cd "$WORK"
git config user.name "DSH Bootstrap"
git config user.email "bootstrap@example.com"
printf '# Widgets\n\nLocal GitLab fixture for dsh-superagent.\n' > README.md
cat > .gitlab-ci.yml <<'YAML'
stages: [test]
test:
  stage: test
  script:
    - echo "local GitLab pipeline ok"
YAML
git add README.md .gitlab-ci.yml
git commit -m "chore: seed the local GitLab fixture"
git branch -M main
git push -u origin main

# Protect main for Maintainers and require a successful pipeline; Free approvals stay optional.
curl -fsS --request POST --header "PRIVATE-TOKEN: $ROOT_TOKEN" "$HOST/api/v4/projects/$PROJECT_ID/protected_branches" \
  --data "name=main&push_access_level=0&merge_access_level=40&allow_force_push=false" >/dev/null || \
curl -fsS --request PUT --header "PRIVATE-TOKEN: $ROOT_TOKEN" "$HOST/api/v4/projects/$PROJECT_ID/protected_branches/main" \
  --data "push_access_level=0&merge_access_level=40&allow_force_push=false" >/dev/null
curl -fsS --request PUT --header "PRIVATE-TOKEN: $ROOT_TOKEN" "$HOST/api/v4/projects/$PROJECT_ID" \
  --data "only_allow_merge_if_pipeline_succeeds=true" >/dev/null

echo "bootstrap complete; credentials in $CREDS"
