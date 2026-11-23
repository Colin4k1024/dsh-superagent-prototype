# 011 — 生产就绪与运维手册

> 承接真实 GitLab 项目前的运维清单与 SOP。目标：把"证明闭环能通"之后剩余的生产级事项，逐项立项并落地。
> 本文档记录当前现状、SOP 和待办（GitHub 仓库未开 issues，立项以本表 + 代码/脚本/自动化落地为准）。

## 0. 立项跟踪

| 立项 | 状态 | 落地 |
| --- | --- | --- |
| P-1 PAT 轮换与密钥加固 | 🔴 待轮换（到期 2026-12-23）+ 待选存储方案 | §2 SOP + §7 周巡检 automation |
| P-2 Runner/CI 可用性监控 | 🟢 可操作 | `scripts/gitlab-runner-check.sh` + 周巡检 automation |
| P-3 门禁与审批策略评审 | 🟡 待决策 | §5（`src/app/merge-gate.ts` 已实现） |
| P-4 测试内绝对路径硬化 | 🟡 可选（当前不红） | §6 |

## 1. 现状清单（两套在线部署，均已走通完整闭环）

| 项目 | 仓库 | projectId | Agent 身份 | PAT id / 到期 | Profile / 端口 | StateDir |
| --- | --- | --- | --- | --- | --- | --- |
| 演示项目 | `s04795/agent/harness-demo` | 12461 | `project_12461_bot_a09e…` | 4529 / **2026-12-23** | `superagent-gitlab` / 3083 | `~/.dsh/state/superagent-gitlab-local` |
| 真实项目 | `s04795/agent-runtime` | 17286 | `project_17286_bot_ceb1…` | 4536 / **2026-12-23** | `superagent-gitlab-runtime` / 3084 | `~/.dsh/state/superagent-gitlab-runtime` |

权威实验结论（`agent-runtime` 上验证）：
- `main` 三条合入全绿、全部走同一门禁：基线修复 `60cc6d91` → agent 生产功能 `7b89600a` → agent 补测 `057e1380`。
- 闭环可重复：issue → agent 读代码/写代码/写测试 → MR → `verify:lint`+`verify:unit` 全绿 → 人工批准 → host 合并门禁 → Maintainer CLI 合并 → ticket `outcome=merged` + KV `gitlab-merge:<iid>` 审计。

## 2. 密钥与 PAT 生命周期（立项 P-1）

**现状（明文风险点）**
- Bot PAT 明文落盘：`~/.config/glab-agent/config.yml`（12461）、`~/.config/glab-agent-runtime/config.yml`（17286），`use_keyring: "false"`。
- 另有 `~/.dsh/secrets/hgit-agent-token`、`~/.dsh/secrets/hgit-agent-runtime-token`（600 权限）。
- fanjia 的 Maintainer token 走 keyring（`glab:hgit.haier.net:token`）。

**SOP：轮换一个项目的 Bot PAT（在到期前执行）**

1. 用 Maintainer 身份新建 project access token（Mirror 现有 scope/role）：
   ```bash
   GLAB=~/.dsh/secrets/hgit-maintainer-glab
   $GLAB api 'projects/<PROJECT_ID>/access_tokens' --method POST \
     -F 'name=dsh-agent-runtime-v2' -F 'scopes=["api","write_repository"]' \
     -F 'access_level=30' -F 'expires_at=<+1年>'
   ```
2. 记录返回的 `token`（仅展示一次）→ 写入 `<bot>` 的 token 文件（600）。
3. 更新 bot glab 配置（`GLAB_CONFIG_DIR/.../config.yml`）里的 `token:` 与新 `user:`。
4. 重启对应 profile：`node .../bin/dsh --profile <profile> --no-open`。
5. 用 `curl -H 'X-Orchestrator-Request:1' .../orchestrator/api/state` 校验 `setup.problem == null` 且 `health.gitlab.state == ready`。
6. 吊销旧 PAT：`$GLAB api 'projects/<PROJECT_ID>/access_tokens/<OLD_ID>' --method DELETE`。

> 自动化巡检见「§7 定时任务」；自动轮换因需 Maintainer 权限与重启，保留人工步骤。

## 3. 新项目接入 SOP（一进程一项目，D8）

D8 锁定：**每个 GitLab 项目一个独立 DSH 进程（profile/port/stateDir/agent PAT 各自隔离）**。接入一个新项目：

```bash
# 1) 建 PAT（§2 步骤 1）；2) 写 bot glab wrapper + config（复用 §2 步骤 2-3）
# 3) 一键 profile + 源/策略配置
scripts/provision-gitlab-project.sh \
  --host https://hgit.haier.net \
  --project GROUP/SUB/PROJECT \
  --port 3085 \
  --profile superagent-gitlab-<name> \
  --cli ~/.dsh/secrets/hgit-agent-<name>-glab \
  --merge-cli ~/.dsh/secrets/hgit-maintainer-glab \
  --allowed fanjia
```

脚本做四件事：建 profile 目录（cordis 补丁 + package.json + node_modules 软链）→ `pnpm install` → 后台 `dsh --profile … --no-open` → 调 `local-test/configure-internal.py`（`GITLAB_BASE` 指向新端口）。

## 4. Runner / CI 健康检查（立项 P-2）

前置条件：项目可用 runner 必须 `online` 且能拉内网镜像 `harbor-test.haier.net/paas/python:3.12-slim`。
`agent-runtime` 基线曾因 CI 镜像缺 `/bin/kill` 长期红——接入新项目先跑：

```bash
scripts/gitlab-runner-check.sh 17286
```

输出：可用 runner + 在线状态 + 最近一次流水线各 job 状态。

## 5. 门禁与审批策略（立项 P-3，已实现待评审）

`src/app/merge-gate.ts` 现状（默认）：
- 需 `state=open`、非 draft、head SHA 匹配、`mergeable`、`pipeline.status==success`；
- 至少 1 个非作者 approval；当 diff 触及 `SENSITIVE_PATHS` 或行数 `MAX_LINES=200` 时提为 2 个；
- 允许发起人 = `policy.sources.gitlab.allowed`（当前 `fanjia`）。

待决策（见 issue）：1 vs 2 审批阈值的项目级覆盖；`SENSITIVE_PATHS` 清单是否需要按仓库定制。

## 6. 代码内绝对路径硬化（立项 P-4，低优先级）

已修：`/bin/kill` → `os.kill`（`agent-runtime` 基线修复）。
残余：`management/tests/unit_tests/test_reconcile.py` 三处 `/bin/sleep`（coreutils 存在、当前不红，但属脆弱点）。可选：改成 `shutil.which("sleep")` 或 `sys.executable` 派生。

## 7. 定时任务（自动化巡检）

- `production/gitlab-pat-expiry-audit`：每周一 09:00（Asia/Shanghai）只读巡检两个 PAT 的到期日与 runner 在线状态；< 14 天到期时输出轮换提醒。
- 触发方式：`automation_create`（独立 Session，`read-only` 权限）。