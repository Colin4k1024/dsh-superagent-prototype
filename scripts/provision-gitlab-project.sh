#!/usr/bin/env bash
# 为新 GitLab 项目一键搭好一个独立 profile（一进程一项目，D8），并完成源/策略配置。
#
# 前置（手工完成，见 docs/011-production.md §2/§3）：
#   1) 已用 Maintainer 身份创建该项目 Bot 的 project access token；
#   2) 已写好 Bot 的 glab wrapper（GLAB_CONFIG_DIR 指向独立 config，含 token）。
#
# 用法（在 dsh-superagent-prototype 仓库根目录执行）：
#   scripts/provision-gitlab-project.sh \
#     --project s04795/agent-runtime --port 3085 --profile superagent-gitlab-foo \
#     --cli ~/.dsh/secrets/hgit-agent-foo-glab --allowed fanjia
set -euo pipefail

# ---------------- 参数 ----------------
HOST="https://hgit.haier.net"
PROJECT=""
PORT=""
PROFILE=""
CLI=""
MERGE_CLI="$HOME/.dsh/secrets/hgit-maintainer-glab"
ALLOWED="fanjia"
DSH_BIN="$(command -v dsh || echo /Users/fanjia/.nvm/versions/node/v24.18.0/bin/dsh)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-$HOST}"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --cli) CLI="$2"; shift 2 ;;
    --merge-cli) MERGE_CLI="$2"; shift 2 ;;
    --allowed) ALLOWED="$2"; shift 2 ;;
    --dsh-bin) DSH_BIN="$2"; shift 2 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

: "${PROJECT:?需要 --project GROUP/SUB/PROJECT}"
: "${PORT:?需要 --port}"
: "${PROFILE:?需要 --profile}"
: "${CLI:?需要 --cli <bot glab wrapper>}"

HOSTNAME="$(python3 -c "import urllib.parse,sys;print(urllib.parse.urlparse(sys.argv[1]).hostname)" "$HOST")"
STATE_DIR="$HOME/.dsh/state/$PROFILE"
PROF_DIR="$HOME/.dsh/profiles/$PROFILE"

echo ">> 目标: $HOST / $PROJECT (port $PORT, profile $PROFILE)"

# ---------------- 1. 生成 profile 目录 ----------------
mkdir -p "$PROF_DIR"
cat > "$PROF_DIR/cordis.yml" <<'YAML'
# dsh profile root — 空入口；树由 package.json bundles + cordis.patch.yml 组装。
[]
YAML
cat > "$PROF_DIR/package.json" <<JSON
{
  "name": "dsh-profile-${PROFILE}",
  "private": true,
  "dependencies": {
    "dsh-superagent": "link:${REPO_ROOT}"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-superagent"
      ]
    }
  }
}
JSON
cat > "$PROF_DIR/pnpm-workspace.yaml" <<'YAML'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
YAML
cat > "$PROF_DIR/cordis.patch.yml" <<YAML
- id: webserver
  config:
    host: 127.0.0.1
    port: ${PORT}
- id: dsh-superagent
  config:
    stateDir: ${STATE_DIR}
- id: dsh-superagent-gitlab
  disabled: false
- id: dsh-superagent-github
  disabled: true
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      qwen:
        apiKeyEnv: QWEN_API_KEY
        api: openai-completions
        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
        models:
          - id: deepseek-v4-pro-0813
          - id: deepseek-v4.1-flash
          - id: deepseek-v4-flash-0731
          - id: qwen3.8-max
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: qwen
    model: deepseek-v4.1-flash
YAML

# ---------------- 2. 安装依赖（建立 dsh-superagent 软链） ----------------
( cd "$PROF_DIR" && pnpm install >/dev/null )

# ---------------- 3. 启动 profile ----------------
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo ">> 端口 $PORT 已被占用，跳过启动（可能已在运行）"
else
  nohup node "$DSH_BIN" --profile "$PROFILE" --no-open > "/tmp/dsh-$PROFILE.log" 2>&1 &
  echo ">> 已后台启动 dsh (pid $!)，等待端口 $PORT 就绪…"
  for _ in $(seq 1 30); do
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 1
  done
fi

# ---------------- 4. 源/策略配置 ----------------
BOT_USER="$("$CLI" api user --hostname "$HOSTNAME" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("username",""))')"
COMMIT_EMAIL="${BOT_USER}@noreply.${HOSTNAME}"

GITLAB_BASE="http://127.0.0.1:${PORT}" \
GITLAB_HOST="$HOST" \
GITLAB_PROJECT="$PROJECT" \
GITLAB_CLI="$CLI" \
GITLAB_MERGE_CLI="$MERGE_CLI" \
GITLAB_COMMIT_EMAIL="$COMMIT_EMAIL" \
GITLAB_ALLOWED="$ALLOWED" \
python3 "$REPO_ROOT/local-test/configure-internal.py"

echo ">> 完成。web: http://127.0.0.1:$PORT/ ; 校验状态："
curl -sS -H "Host: 127.0.0.1:$PORT" -H 'X-Orchestrator-Request: 1' -H "Origin: http://127.0.0.1:$PORT" \
  "http://127.0.0.1:$PORT/orchestrator/api/state" 2>/dev/null | python3 -c \
  'import sys,json; d=json.load(sys.stdin); print("setup.problem=", d["setup"]["problem"], "| gitlab=", d["health"]["gitlab"]["state"])'