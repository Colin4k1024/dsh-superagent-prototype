# GitLab 落地：Phase 1/2 执行清单

> 上游方案：[GitLab 落地报告](2026-11-19-gitlab-superagent-landing-plan.md)。本文只回答“下一步具体做什么、按什么顺序、每个 PR 怎么验收”。
> 决策基线（已锁定）：D1 Free（self-managed/gitlab.com 待 Phase 0 确认）、D2 单项目、D3 显式 + auto（`autoLabels` 过滤）、D4 Issue/MR 评论/审批、D5 智能体执行合并但合并权在宿主侧、D6 GitLab-only 提示词、D7 project access token + 宿主 Maintainer token、D8 一进程一项目。

---

## 0. 当前进度

| 项 | 状态 | 说明 |
| --- | --- | --- |
| ForgePort 能力骨架 | **已完成（PR 1.1）** | `src/sources/forge.ts`、`SourceKind.capabilities`、`SourceRegistry.forgeOf/forges`、`tests/forge.spec.ts`；GitHub 行为未切换 |
| GitHub 消费方切换 | **已完成（PR 1.2）** | `cards`/`tools`/`runtime`/`assessment`/`resources` 不再直接 import `github-*`；`GithubForge` 适配现有规则 |
| 部署与 setup | **已完成（PR 1.3）** | `Deployment.forge`、`resolveGitlab`、`resolveCodeHost`、Setup 按启用 kind 分派 |
| 传输与 worker 环境 | **已完成（PR 1.4）** | `Commands.gitlab`/`gitlabPages`、glab shim、GitLab host credential、token 清理 |
| GitLab kind 骨架 | **已完成（PR 1.5）** | 配置、fields、policy、environment、health、plugin entry、面板卡片、KV；先不轮询 |
| GitLab Trigger/Channel | **已完成（Phase 2.1/2.2）** | Issue/MR/Note/DiffNote/approval 翻译；Channel 幂等、discussion、gone、quick action 转义 |
| GitLab 轮询与 MR 生命周期 | **已完成（Phase 2.3/2.4）** | streams/todos/subscribed Threads/open MRs；MR 绑定、merged/closed、终态通知 |
| 审批/流水线/上下文 | **已完成（Phase 2.5/2.7）** | approvals 差量、MR/默认分支 pipeline、threadContext、repository reads、checks |
| autoLabels 与宿主合并 | **已完成（Phase 2.6/2.8）** | 带标签才 observed；`orchestrator_merge_request` + mergeGate + Maintainer CLI + 审计 |
| GitLab Source MVP | **完成（2.1–2.9）** | 端到端 canary 与试点验收 |
| GitLab 门禁/Canary | **已完成（2.9 + Phase 4 gate）** | `examples/gitlab/review-gate.*`、apply 脚本、mention canary、docs/009 GitLab 节 |
| 提示词/技能（D6） | **已完成（Phase 3）** | prompts 全面改 MR/glab；`dsh-superagent-gitlab` skill；旧 auto-merge 迁移丢弃 |

PR 1.1 的验收：`pnpm typecheck` 绿；`pnpm test` 1212 个测试全绿（2026-11-19 本地运行）。
PR 1.2 的验收：`pnpm typecheck`/`pnpm build` 绿；`pnpm test` 64 个文件 / 1215 个测试全绿；GitHub golden 保持 `pr_number`，新 `change_number` 路径已有 runtime + unit 覆盖。
PR 1.3/1.4 的验收：`pnpm check` 绿；64 个文件 / 1222 个测试；GitLab setup（host/project/access level/archived/two hosts）与 GitLab API/shim/credential/token 清理已有单测。
PR 1.5 的验收：`pnpm check` 绿；65 个文件 / 1225 个测试；`gitlab-watch` 构建产物存在；面板出现 GitLab 卡片，KV/health/环境变量已注册。
Phase 2.1/2.2 的验收：`pnpm check` 绿；67 个文件 / 1236 个测试；Trigger 的 Issue/MR 双 iid、DiffNote、approval、Channel 幂等/回退/gone/quick action 已有单测。
Phase 2.3/2.4 的验收：`pnpm check` 绿；69 个文件 / 1244 个测试；`pollRound` 的 Issue+note 摄入/游标、note 过滤、MR 绑定与 merged/closed 观察、终态通知已有单测。
Phase 2.5/2.7 的验收：`pnpm check` 绿；70 个文件 / 1249 个测试；approvals 基线/新审批、pipeline 指纹、threadContext、repository file/tree、checks 摘要已有单测。
Phase 2.6/2.8 的验收：`pnpm check` 绿；71 个文件 / 1253 个测试；autoLabels 的 observed 过滤、宿主合并门禁（approvals/pipeline/size/敏感路径/head SHA）、merge CLI 配置已有单测。
Phase 2.9/4 gate 的验收：`pnpm check` 绿；73 个文件 / 1257 个测试；GitLab review-gate 评估器与 canary dry-run 已有单测；`apply-gitlab-review-gate.sh --dry-run` 可执行。
Phase 3 的验收：`pnpm check` 绿；73 个文件 / 1258 个测试；GitLab skill 注册、prompt 合同、旧 prompt 迁移与新 delivery/merge 文案已有覆盖。

---

## 1. Phase 0 还需跑完的探针（与 PR 1.x 并行）

D1 只剩 self-managed/gitlab.com 未定，不阻塞 1.1/1.2，但决定 1.3/1.4 的 host/CA/代理字段。用测试项目逐条记录命令与输出：

| # | 探针 | 命令/做法 | 通过标准 |
| --- | --- | --- | --- |
| P1 | `glab api --paginate` 形态 | `glab api projects/<id>/issues --paginate --per_page=2` | 输出单个 JSON 数组；分页合并正确 |
| P2 | `/approvals` 在 Free 的字段 | `glab api projects/<id>/merge_requests/<iid>/approvals` | 能读到 `approved_by`；读不到则 D5 必须 fail closed |
| P3 | `head_pipeline`/jobs | `glab api projects/<id>/merge_requests/<iid>`；`/pipelines/<pid>/jobs` | 能判断 success/running/manual/allow_failure |
| P4 | `updated_after` 延迟 | 建 Issue/评论后按 `updated_after` 轮询 10 次 | 60–120 秒内可见；记录最大延迟 |
| P5 | 自签 CA | `GLAB_CA_CERT` + `GIT_SSL_CAINFO` + `git ls-remote` | API 与 push 使用同一 CA，均成功 |
| P6 | 凭据助手 | `glab auth login --setup-git-credential-helper` 后 `git ls-remote` | worker gitconfig 的 helper 可被 git 调用 |
| P7 | marker/quick action | 发一条含 `<!-- dsh-superagent:... -->` 和行首 `/` 的 note | marker 保留；行首 `/` 不被执行 |
| P8 | token 权限 | `GET /user`、`GET /projects/:id`、`POST /approve` | access_level≥30；能 approve；不能合并 protected main |

P8 是 D5 的关键：worker token 必须**不能**合并 `main`；宿主 token 必须**能**合并。

---

## 2. Phase 1：PR 拆分（可逐个合并、可回滚）

### PR 1.2：GitHub 包成 ForgePort，通用层改问 registry（已完成）

**接口 diff 草案**：[PR 1.2 接口 diff](2026-11-19-pr-1.2-interface-diff.md)。

**目标**：GitHub 行为逐字节不变，但 `cards/tools/runtime/assessment/resources` 不再 import `github-*`。

**文件**：
- 新增 `src/sources/github-forge.ts`：把 `readPull`/`claimPull`/`observePull`/`pullsOf`/`pullEndNotices` 包成 `ForgePort`；`change.parse` 解析 `github:<number>`。
- `src/sources/github.ts`：`capabilities: { forge: githubForge }`。
- `src/app/cards.ts`：`ticketCard(ticket, change?: ChangeRef)`；`pr_number` 保留为别名（GitHub golden）。调用方传 `sources.forgeOf(source)?.change.numbersOf(ticket)` 的结果。
- `src/app/tools/executor.ts`：宿主 `github: SourceContext` 改为 `sources: SourceRegistry`；`pr_number` 保持，内部用 `registry.forgeOf(ticketSource)`。
- `src/app/runtime.ts`：`pullEndNotices` 改为 `forge.change.terminalNotices`。
- `src/app/assessment.ts`：`readRepositoryPath` 改为 `forge.repositoryRead.read`。
- `src/app/resources.ts`：`github/` 前缀保留，但由 forge 提供；新增 `forge.resources?` 或短期保留 `readGithub`（PR 1.5 再统一）。
- `src/app/links.ts`：`#12` 仍由 GitHub `find` 解释，不改行为。

**验收**：
- `pnpm check` 绿；GitHub 相关测试全部通过；
- 新增 `tests/github-forge.spec.ts`：`parse('github:12')`、`numbersOf`、`terminalNotices` 与旧 `pullEndNotices` 输出一致；
- golden：`ticketCard` 的 `pr_number`、`triggerCard`、`terminal notices` 不变。

**风险**：中。`ticketCard` 签名改动会波及视图/工具；用可选参数 + 默认 undefined 控制爆炸半径，并在 PR 中逐个调用点补 `change`。

### PR 1.3：Deployment.forge 与 GitLab setup（已完成）

**目标**：纯 GitLab 部署不再卡在 `repositoryUnset`；GitHub 配置保留可回滚。

**文件**：
- `src/deployment.ts`：新增 `GitlabAccountsSchema`（host/project/cli/commitEmail）；`Deployment` 增加 `forge: { kind, host?, project, projectId?, cli, login, commitEmail }`；`SETUP_FIELDS` 加 `gitlab`；`resolveDeployment` 拆为 `resolveGithub`/`resolveGitlab`；`Deployment.repository` 在 GitLab 下取 `project`。
- `src/app/setup.ts`：`resolve`/`checkAccounts`/`setupFields` 按启用 kind 分派。
- `src/setup.ts`：`SetupPlace` 加 `'gitlab'`；新增 GitLab 错误码。
- `src/app/http.ts`：`setupView().accounts` 改为按来源的 map（保留 GitHub 字段兼容）。
- `tests/deployment.spec.ts`、`tests/environment.spec.ts`、`tests/fixtures/deployment.ts`：加 GitLab 字段；GitHub 单来源输出不变。

**验收**：GitHub 配置仍能启动；GitLab 配置缺 project/cli 时报可读 setup problem；`pnpm check` 绿。

**风险**：高（启动路径）。用 “GitHub 单来源输出 golden” 锁住旧行为；回滚开关为 `enabled`。

### PR 1.4：Commands.gitlabApi 与 worker 环境（已完成）

**目标**：GitLab API 可按数字 project id 调用；worker 能 `glab` + git push；worker 不能读宿主 merge token。

**文件**：
- `src/infra/commands.ts`：新增 `gitlabApi()`/`gitlabPages()`；`projectPath()` 用 `projects/<id>/`，保留越界检查；`pages()` 的 GitHub 路径不变。
- `src/infra/environment.ts`：`WORKER_COMMANDS` 加 `glab`；`writeEnvironment` 写 `glab` shim、`credential.https://<host>.helper`、`insteadOf`；`agentVariables` 清除 `GITLAB_TOKEN`/`GLAB_*`；`verifyEnvironment` 按启用 host 校验。
- `src/app/setup.ts`：`writeEnvironment` 接收 `forge`；CA 变量注入 `Commands.environment`。
- `tests/commands.spec.ts`、`tests/environment.spec.ts`：prefix/host/CA 参数化。

**验收**：GitLab API 调用路径不越界；`git ls-remote` 与 `glab api user` 均成功；worker 环境无 `GITLAB_TOKEN`；`pnpm check` 绿。

**风险**：高（凭据/CA）。先做“API 通”与“git push 通”两个独立验收，不要混在一起。

### PR 1.5：GitLab kind 骨架与面板（已完成）

**目标**：`source:gitlab` 卡片可见、可保存、可报 health；先不轮询。

**文件**：
- `src/sources/gitlab.ts`：`GitlabConfigSchema`、`fields`、`health: ['gitlab']`、`facts`、`find`、`capabilities: { forge: gitlabForge }`（占位，Phase 2 实现）、plugin entry。
- `src/sources/gitlab-trigger.ts`/`gitlab-mr.ts`/`gitlab-channel.ts`/`gitlab-read.ts`：先放最小类型/占位，Phase 2 填实现。
- `src/kv.ts`：`gitlab` 键族。
- `tsdown.config.ts`、`package.json`、`cordis.patch.yml`：`gitlab-watch` entry/export/insert（默认 disabled）。
- `src/client/locales.ts`、`src/client/ticket.tsx`、`locale/*.json`：`source.gitlab`/`health.gitlab`/`problemSetupFix.gitlab`/图标。
- `src/app/context.ts`、`prompts.ts`、`sessions.ts`、`skill-files.ts`：`skill/gitlab` 与 `sourceSkills` 类型扩展。
- `docs/007`：模块/测试表登记新文件（否则 `docs.spec` 红）。

**验收**：面板出现 GitLab Source 卡片；保存错误配置显示 setup problem；`pnpm check` 绿；GitHub 行为不变。

### PR 1.6：回滚与文档

**目标**：能在 10 分钟内从 GitLab 切回 GitHub。

**文件**：`docs/006`、`SETUP.md`、`docs/009`（GitLab 节）、`reports/` 链接；`tests/deployment.spec.ts` 加回滚用例。
**验收**：关闭 gitlab、启用 github、重启，旧数据可读；文档步骤可照做。

---

## 3. Phase 2：GitLab Source MVP 任务

按依赖排序；每个任务都可单独提 PR，并带测试。

| # | 任务 | 文件 | 验收/测试 | 依赖 |
| --- | --- | --- | --- | --- |
| 2.1 | Trigger 翻译（已完成） | `gitlab-trigger.ts` | Issue/MR/Note/DiffNote 的 id、thread、actor、human、addressed、channel；`tests/gitlab-trigger.spec.ts` | 1.5 |
| 2.2 | Channel（已完成） | `gitlab-channel.ts` | 顶层 note、discussion 跟帖、marker 幂等、系统注释回退、`gone`、quick action 转义；`tests/gitlab-channel.spec.ts` | 2.1 |
| 2.3 | 轮询与游标（已完成） | `gitlab.ts`、`gitlab-read.ts` | streams/todos/订阅 Thread/open MRs；429 不计失败；`tests/gitlab-poll.spec.ts` | 2.1/2.2 |
| 2.4 | MR 生命周期/绑定（已完成） | `gitlab-mr.ts` | `claim`/`observe`/`numbersOf`/`terminalNotices`；merged/closed 才 `threadClosed`；`tests/gitlab-mr.spec.ts` | 2.1/2.3 |
| 2.5 | 审批与 pipeline（已完成） | `gitlab-mr.ts`/`gitlab-read.ts`/`gitlab.ts` | `/approvals` 差量 Trigger；`head_pipeline` 快照；manual/allow_failure；默认分支 pipeline；`tests/gitlab-ci.spec.ts` | 2.4 |
| 2.6 | autoLabels 与 scope（已完成） | `gitlab.ts` | 带标签 Issue/MR → observed；不带标签未 @ → 不接单；显式 @ 仍 admitted；`tests/gitlab.spec.ts` | 2.1 |
| 2.7 | threadContext/仓库读（已完成） | `gitlab-read.ts` | notes 窗口、diff note 的 path/line、`repository/files` raw/tree；`tests/gitlab-ci.spec.ts` | 2.1 |
| 2.8 | 宿主合并工具（已完成） | `src/app/tools/executor.ts`、`src/app/merge-gate.ts`、`src/sources/gitlab-mr.ts` | `orchestrator_merge_request`；mergeGate；Maintainer CLI；KV 审计；`tests/merge-gate.spec.ts` | 1.3/1.4/2.4/2.5 |
| 2.9 | canary/e2e（已完成） | `scripts/gitlab-mention-canary.mjs`、`tests/` | dry-run + 目标实例 20/20、p95<2min；e2e 1–12 条 | 2.1–2.8 |

**Phase 2 的硬门禁**：
- `tests/docs.spec.ts` 模块/测试表完整；
- `tests/model-surface.spec.ts` 文本预算（新增 GitLab skill 后重算）；
- 重复读 100 次 0 重复工单；
- 429 连续 3 轮 health 不变红；
- worker 直接 merge protected `main` 返回 403。

---

## 4. 关键路径与并行

```text
1.1 → 1.2 ─┬→ 1.3 ─┐
           └→ 1.4 ─┴→ 1.5 → 2.1 → 2.2/2.3 → 2.4 → 2.5/2.6/2.7 → 2.8 → 2.9
```

- 1.3 与 1.4 可并行；1.4 的 CA/凭据依赖 P5/P6 探针。
- 2.2（Channel）与 2.3（轮询）可并行；2.5/2.6/2.7 在 2.4 后并行。
- 2.8 依赖 1.3/1.4 的 token 边界，建议在 2.4 完成后立即设计，不要等到 Phase 4。

---

## 5. 每个 PR 的通用 Definition of Done

1. `pnpm typecheck` 绿；
2. `pnpm test` 全绿（至少新增/修改的 spec + `docs.spec`/`class-docs`/`model-surface`）；
3. GitHub 旧行为有 golden 或针对性回归测试；
4. 新增文件登记进 `docs/007` 模块/测试表；
5. 不引入新的通用层 `github-*` import（PR 1.2 后）；
6. 配置/环境变量变更写进 `docs/006` 或 `SETUP.md`；
7. 回滚路径明确（`enabled` 开关 + 不迁移旧数据）。

---

## 6. 下一步

- **PR 1.1–1.5、Phase 2.1–2.9、Phase 3 与 Phase 4 gate 已完成。** 剩余：真实试点（5–10 个 Issue、2 周）与部署文档（SETUP/006）。
- 并行：P1–P8 探针；P2/P8 结果决定 D5 是否能在目标 Free 实例按设计工作。
- 试点前先跑 `scripts/gitlab-mention-canary.mjs` 与目标实例的 e2e 1–12 条；再按 docs/009 安装门禁。
