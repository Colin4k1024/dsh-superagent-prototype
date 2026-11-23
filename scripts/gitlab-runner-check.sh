#!/usr/bin/env bash
# 检查一个 GitLab 项目的 Runner 可用性与最近一次流水线状态。
#
# 用途：接入新项目前，确认该项目能用在线 runner 跑 CI（否则合并门禁永远红）。
# 用法：scripts/gitlab-runner-check.sh <project-id-or-path>
# 依赖：glab（默认用 Maintainer wrapper，可用 GLAB 覆盖）、python3。
set -euo pipefail

GLAB="${GLAB:-$HOME/.dsh/secrets/hgit-maintainer-glab}"
PROJECT="${1:?用法: gitlab-runner-check.sh <project-id-or-path>}"

echo '== 项目 =='
$GLAB api "projects/$PROJECT" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d.get("path_with_namespace"), "id=", d.get("id"), "default_branch=", d.get("default_branch"))
'

echo '== Runner 清单（在线/可用） =='
$GLAB api "projects/$PROJECT/runners?per_page=100" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else []
if not rows:
    print("  (无专用 runner；共享 runner 是否可用需看最近流水线)")
for r in rows:
    online = "online" if r.get("online") else "OFFLINE"
    desc = r.get("description") or "(无描述)"
    print("  #%s  %-20s  status=%-16s online=%s" % (r.get("id"), desc, r.get("status"), online))
'

echo '== 最近一次流水线各 job =='
PIPELINE_ID=$($GLAB api "projects/$PROJECT/pipelines?per_page=1&order_by=id&sort=desc" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
print(d[0]["id"] if d else "")
')
if [ -z "$PIPELINE_ID" ]; then
  echo '  (无流水线记录)'
else
  $GLAB api "projects/$PROJECT/pipelines/$PIPELINE_ID/jobs" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
for j in d:
    r = j.get("runner") or {}
    runner = "%s(%s)" % (r.get("id"), r.get("description")) if r else "未分配"
    print("  %-14s %-11s runner=%s" % (j.get("name"), j.get("status"), runner))
'
fi

echo '== 结论 =='
$GLAB api "projects/$PROJECT/runners?per_page=100" 2>/dev/null | python3 -c '
import sys, json
d = json.load(sys.stdin)
rows = d if isinstance(d, list) else []
online = sum(1 for r in rows if r.get("online"))
print("  专用 runner: %d 个，在线 %d 个" % (len(rows), online))
print("  若专用/共享 runner 全离线，请先在项目的 CI/CD Runner 设置里启用在线 runner，再接 agent。")
'