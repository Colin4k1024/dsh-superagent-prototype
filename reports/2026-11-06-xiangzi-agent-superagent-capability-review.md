# xiangzi-agent（dsh-superagent）实战能力评估

> 评估对象：`Colin4k1024/xiangzi` 仓库上的 `xiangzi-agent`（dsh-superagent 部署）
> 评估窗口：2026-11-04 至 2026-11-06（数据截止 2026-11-06 16:45 CST）
> 评估方式：只依据**实际发生的工单、PR、CI、会话日志、编排数据库和当前运行状态**，不把设计文档当成实测能力
> 一句话结论：**它已经是一个很强、很诚实的“issue → PR 工程师”；但还不是一个可靠、可治理、可放大的“superagent”。**

---

## 0. 结论摘要

### 0.1 总评

| 口径 | 分数 | 判断 |
| --- | --- | --- |
| 当前形态：单仓库 + 明确 issue + 人工合并 | **7.0 / 10** | 交付质量高，边界内可用；可靠性拖后腿 |
| 目标形态：主动、多源、并发、团队级自治 | **5.5 / 10** | 关键能力尚未被验证，部分尚未实现 |
| 工程执行（理解/实现/验证/交付） | **8.6 / 10** | 接近高级工程师水平，PR 质量高于多数人类初稿 |
| 控制面（接单/可靠性/运维/治理） | **4.8 / 10** | 会丢消息、会红健康、评审形同虚设 |

### 0.2 五条关键判断

1. **交付能力已被证明。** 5 个实质工单全部在 28–73 分钟内交付（7–49 分钟开 PR），5/5 合并，5 个 issue 全部关闭；CI 全绿（8/8 或 9/9），PR 说明、验证记录和限制声明质量很高。
2. **它擅长“已经被想清楚”的任务。** 5 个工单都带有目标、范围、验收标准、非目标和 ADR/文件指针；这不是普通需求的输入质量。对模糊需求、冲突需求、多仓库迁移的泛化能力**尚未证明**。
3. **最大的问题不是写代码，而是接单。** 2026-11-06 01:18–01:19 同一两分钟窗口内的 3 条 @ 提及全部没有进入触发表；`#257` 被连续重发 4 次，直到 05:55 才被接单，人工等待 **4 小时 36 分**。这不是模型能力问题，是 intake 可靠性问题。
4. **“人工 review”在当前可观测的 GitHub 实践中没有发生。** 5 个 PR 在 GitHub 上 **0 条 review、0 条评论**；包括 1,882 行 / 36 文件的 ADR-021 实现在内，全部在 CI 通过后 2–5 分钟内被合并。CI 绿不等于设计正确、边界正确、意图正确。
5. **运行层仍然脆弱。** 评估时 `status` 显示 `github: error`、连续 **111 次轮询失败**；根因之一是一个已被删除的测试 issue 返回 404，被当成普通读失败永久重试。另有一次损坏的 session 日志导致 7 个组件启动失败，需要人工搬走备份目录才恢复。

---

## 1. 评估范围与证据

### 1.1 纳入了什么

- **6 个由 superagent 接单的 ticket**（数据库 `~/.dsh/state/superagent/orchestrator.sqlite`）
  - `#243` 评论回复冒烟测试
  - `#256` Phase 3 文档纠偏 → PR #262
  - `#259` E020-6 浏览器测试集 → PR #265
  - `#255` 浏览器每 Bot 微隔离 → PR #266
  - `#254` ADR-021 多 Bot 协作 → PR #267
  - `#257` iOS/移动端冷启动评估 → PR #268
- **5 个合并 PR**：`#262`、`#265`、`#266`、`#267`、`#268`
- **6 个 worker 会话的完整 JSONL 事件流**：1,862 个 step、2,049 次工具调用、28 次工具错误、2.52M 输入 token、583k 输出 token、247.6M cache-read token
- **38 条评估决策、40 条触发、13 条 outbox 投递**
- **当前进程健康状态**（`./scripts/dsh-superagent status`）
- **启动故障证据**（`.artifacts/dsh-superagent-superagent-20261104-095813-57827.log`）

### 1.2 排除了什么

- **不把 `#250`、`#251` 算作本 superagent 的工单。** 它们虽然由 `xiangzi-agent` 账号提交，但分支是 `feat/*` 而不是 `agent/<ticket>`，数据库中没有对应 ticket，也没有自动 agent 声明；更像人工或另一套会话的产物。
- **不把设计文档当成实测。** `docs/` 描述的是设计意图；本报告只在“设计 vs 实测”对照中使用它。
- **不把 CI 绿当成正确性证明。** CI 验证的是作者自己写的测试；没有人独立核对验收标准。
- **不把一次成功当成稳定能力。** 样本只有 3 天、1 个仓库、1 个用户、1 个 flash 模型、5 个实质任务。

### 1.3 数据口径

- 时间统一为 UTC；文中标注的“本地时间”为 UTC+8。
- “交付完成”指 worker 发出 `orchestrator_report(state=ready)`；“合并”指人类在 GitHub 上 merge。
- “人工介入”只统计 GitHub 上的 review / comment / merge；本地操作无法观测。
- 工具错误按 `tool/result.isError` 统计；不含 bash 退出码非 0 但被 agent 自行处理的普通失败。

---

## 2. 实测结果总览

### 2.1 工单与 PR

| Ticket | 请求 | 产出 | 变更量 | 用时（接单→交付） | 合并用时（CI 后） | Review |
| --- | --- | --- | --- | --- | --- | --- |
| `#256` | 纠正 Phase 3 过期文档 | PR #262 | +96/−38，6 文件 | 73 分钟 | 隔夜，14h44m | 0 |
| `#259` | E020-6 浏览器负面/并发/恢复测试 | PR #265 | +1,582/−63，16 文件 | 37 分钟 | 5 分钟 | 0 |
| `#255` | 浏览器每 Bot 微隔离 A1-a/b/c | PR #266 | +610/−214，10 文件 | 28 分钟 | 2 分钟 | 0 |
| `#254` | ADR-021 D1–D5 多 Bot 协作 | PR #267 | +1,882/−50，36 文件 | 68 分钟 | 3 分钟 | 0 |
| `#257` | iOS/移动端冷启动评估（仅评估） | PR #268 | +597/−2，4 文件 | 43 分钟 | 2 分钟 | 0 |
| `#243` | 回复“收到 3/4/端到端验证成功” | 3 条评论 | 0 | 66 秒 | — | — |

**合计（5 个实质 PR）**：+4,767 / −367 行，72 个文件，5/5 合并，5/5 issue 关闭，0 条 review，0 条 PR 评论。CI 结果：`#262` 9/9、`#265` 8/8、`#266` 9/9、`#267` 9/9、`#268` 9/9。

### 2.2 时延与吞吐

| 指标 | 实测 |
| --- | --- |
| 人工 @ → agent 确认 | 41–81 秒（成功接单的样本） |
| 确认 → PR 创建 | 7–49 分钟 |
| 接单 → ready 交付 | 28–73 分钟（均值约 50 分钟） |
| CI 完成 → 人工合并 | 2–5 分钟（4 个样本）；`#262` 隔夜 |
| 单日完成工单数 | 最多 4 个（11-06：`#259`/`#255`/`#254`/`#257`） |
| 并发工单 | 实际为 **1**；配置 `maxWorkers=3`，但样本内没有重叠执行 |
| 失败/回滚 | 0 个已合并 PR 被回滚；观察窗口仅数小时 |

### 2.3 资源消耗

| 指标 | 6 个 worker 合计 | 最大单工单 |
| --- | --- | --- |
| step | 1,862 | 904（`#254`） |
| 工具调用 | 2,049 | 929（`#254`） |
| bash 命令 | 1,116 | 509（`#254`） |
| 工具错误 | 28（1.4%） | 14（`#254`） |
| 输入 token | 2.52M | 889k（`#254`） |
| 输出 token | 583k | 180k（`#254`） |
| cache-read token | 247.6M | 125.5M（`#254`） |
| 峰值上下文 | 197,573 | 197,573（`#257`） |
| compaction | 最多 2 次 | 2 次（`#254`） |
| worker 墙钟时间 | 约 254 分钟 | 73 分钟（`#256`） |

> 解读：价值密度高，但**成本主要花在“反复读上下文”和“轮询后台任务”**，不是花在写代码。`#254` 一个工单 125.5M cache-read token，说明每一步都在重读接近 200k 的上下文；`#257` 只是一个 597 行的文档任务，也打到 197k 上下文并触发 compaction。

### 2.4 工具错误分布

| 类型 | 次数 | 说明 |
| --- | --- | --- |
| `file changed since it was read` | 5 | 主要在 `#255` 的 `server.ts`；读后文件被改，重读可解 |
| `file has not been read` | 4 | fs 策略要求先读后写，属流程摩擦 |
| `old_string and new_string must differ` | 3 | 无效编辑尝试，低风险 |
| `web_search` 无 API key | 1 | `#257` 首次调研退化为 `curl` |
| 路径解析/其它 | 15 | 多为一次性、可恢复 |

没有发现：跳过测试、`#[ignore]`、`continue-on-error`、`--no-verify`、`unsafe`、把测试改成永远通过、在 CI 里放行失败。**这是优点，不是理所当然。**

### 2.5 沟通与人工注意力

| 指标 | 实测 |
| --- | --- |
| outbox 消息 | 13 条，全部 `sent`，0 条 dropped |
| 消息构成 | 5 条确认 + 5 条结果 + 2 条 follow-up + 1 条测试 |
| 每个实质工单平均消息 | 约 2.2 条 |
| 进度噪音 | 未发现；没有“正在做”“快好了”式刷屏 |
| 人工重复 @ | **6 次**（`#254` 1 次、`#255` 1 次、`#257` 4 次） |
| PR 中的自动 agent 声明 | 5/5 有 |
| PR 中的验证命令与限制声明 | 5/5 有，且大体诚实 |

---

## 3. 能力维度评分

评分针对**本机、单用户、单仓库、人工合并**这一实际部署；不等于通用产品分。

| # | 维度 | 权重 | 分数 | 一句话判断 | 关键证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | 需求理解与范围控制 | 14% | **9.0** | 强 | “评估非实现”只出文档；5 个工单都对照验收标准；无越界改动 |
| 2 | 代码实现 | 14% | **8.5** | 强 | 1,882 行 / 36 文件含迁移、向后兼容、审计链；无危险模式 |
| 3 | 测试与自验证 | 14% | **8.0** | 强，但自证 | `#254` 81 次 cargo test；fmt/clippy/build/boundary/migration up-down；CI 9/9 |
| 4 | 交付与沟通 | 10% | **9.0** | 很强 | PR 说明含验证、限制、非目标；13 条消息 0 噪音；自动声明齐全 |
| 5 | 接单/授权/路由 | 8% | **8.0** | 基本正确 | 30/30 非人类触发被忽略；6 个显式接受；allowlist 生效 |
| 6 | 触发可靠性 | 7% | **4.0** | 明显短板 | 6 条人类 @ 丢失；`#257` 等待 4h36m |
| 7 | 长程自主/恢复 | 9% | **6.5** | 能扛长任务 | 904 step / 68 分钟完成；2 次 compaction；但对丢消息无自愈 |
| 8 | 可靠性与可运维 | 8% | **4.5** | 脆弱 | 111 次轮询失败；删除线程毒化健康；session 损坏导致启动失败 |
| 9 | 安全与治理 | 6% | **4.5** | 本机可接受，团队级不足 | worker `danger-full-access` + `approval never`；0 review；默认 binding fail-open |
| 10 | 效率与成本 | 4% | **6.0** | 值，但重 | 28–73 分钟/单；247M cache-read；287 次 job_output / 22 次 job_kill |
| 11 | 并发/多源/主动 | 3% | **3.0** | 未证明 | 实际并发 1；Feishu 未用；主动模式仅 observe |
| 12 | 学习/记忆/泛化 | 3% | **3.0** | 未证明 | 无跨工单记忆；输入均为高质量明确需求；无模糊/多仓库样本 |

**加权总分：7.0 / 10。**

> 分档解释：8–10 为“可依赖”，6–8 为“可用但需看护”，4–6 为“有明显风险”，<4 为“不要放大”。
> 工程执行四维（1–4）加权 **8.6**；控制面四维（5–8）加权 **5.8**；扩展四维（9–12）加权 **4.3**。

> 评分是启发式判断，不是精确测量；样本只有 5 个任务，权重的目的不是制造小数精度，而是暴露“执行强、控制面弱”的结构。

---

## 4. 做得好的地方（有证据）

### 4.1 端到端闭环真的跑通了

不是 demo：从 GitHub @ 提及 → 建 ticket → 创建 worktree → 读上下文 → 改代码 → 跑测试 → 开 PR → 回评论 → 人工合并 → issue 自动关闭，全链路在 5 个任务上重复成功。

- `#259` 01:15 接单，01:33 开 PR，01:53 报告 ready，01:58 合并。
- `#254` 03:20 接单，04:09 开 PR，04:27 报告 ready，04:30 合并。
- `#257` 05:56 接单，06:05 开 PR，06:39 报告 ready，06:40 合并。

### 4.2 PR 说明的质量高于多数人类初稿

以 `#267`（ADR-021）为例，PR 正文按 D1–D5 逐项对应实现，单独列出“迁移与兼容”“API”“验证”“限制”。`#266`、`#265` 同样给出验证命令与预期结果。`#262` 主动说明“cargo test 首次因共享 Postgres 连接池超时失败，rerun 后通过；与本次文档改动无关”。

这类“验证记录 + 限制 + 非目标”的结构，显著降低了 review 成本，也让“它有没有吹牛”变得可检查。

### 4.3 范围纪律好，没有“顺手重构”

- `#257` 明确“评估，非实现”，最终只改 `docs/`、`mkdocs.yml`、路线图，没有碰代码。
- `#256` 只改文档，没有借机改代码。
- `#259` 只补测试与 fixture，没有改业务行为。
- `#255`/`#254` 的改动都能逐文件对上 issue 范围。

### 4.4 验证不是摆设

`#254` 的 worker 会话里出现了：

- 81 次 `cargo test` 相关调用（含定向单测、集成测试、fault injection）；
- 8 次 `cargo clippy --workspace --all-targets --all-features -- -D warnings`；
- 6 次 `cargo fmt --all --check`；
- `cargo build --workspace --bins`；
- `./scripts/check-crate-boundaries.sh`；
- 迁移 up/down 与 schema version 断言。

最终 CI 9/9 通过。它不是“写完就交”，而是真的在本地迭代到绿。

### 4.5 诚实度高于预期

- `#266` 明确写“本次未做真实多 Bot 端到端浏览器联调”；
- `#267` 明确写“Bot 生命周期当前只覆盖创建/读取/委派；停用、删除与委托授权修改留待后续”；
- `#268` 明确把需求频次标为 `NOT_PROVEN`，没有把假设包装成结论；
- `#262` 主动交代 CI 抖动。

这些“限制声明”与 PR 实际内容基本对得上，没有发现明显虚报。

### 4.6 低噪音沟通

6 个工单只产生 13 条对外消息，且没有进度刷屏。对一个“会消耗全团队注意力”的 agent 来说，这是正确的产品直觉。

### 4.7 大改动也能扛

`#267` 在 68 分钟内完成 36 文件、1,882 行，包含：

- 新迁移 `0029`（up/down）；
- `Bot`/`BotId`/`DelegationId`/`Assignee` 领域模型；
- `Task.assignee` 的 serde 向后兼容；
- 审计哈希链的 `actor_bot` 扩展段，且保持历史 `None` 行可验证；
- 跨租户/跨 Bot fail-closed 的仓储与 API 测试。

这不是“堆代码”，而是有设计意识的改动。

---

## 5. 关键问题（按严重度）

### P0-1：会丢人的 @ 提及，且不是偶发

**事实**（GitHub 评论时间，UTC）：

| Issue | 人工评论 | 是否进入触发表 | 备注 |
| --- | --- | --- | --- |
| `#259` | 01:15:23 | 是 | 紧接着的窗口正常 |
| `#254` | 01:18:21 | **否** | 03:19:49 重发后才接单，延迟 2h01m |
| `#255` | 01:18:23 | **否** | 02:47:33 重发后才接单，延迟 1h29m |
| `#257` | 01:19:40 | **否** | 之后 04:31、05:22、05:43 三次重发仍未进入 |
| `#257` | 05:55:16 | 是 | 05:56:08 确认；距首次请求 4h36m |

- 编排库 `trigger` 表里没有 01:18–01:19 那批记录，`thread` 表也没有对应 thread；说明它们**从未被源读入**，不是被 eval 忽略。
- 同一两分钟窗口内的 3 条 mention 全部丢失；开工前的 11 条人工 @ 评论里只有 5 条进入触发表，6 条丢失。之后单独重发即成功，呈现明显的“突发批次丢失”特征。
- 最可能的根因：`src/sources/github.ts` 的通知轮询使用 `notifications?all=true&since=<cursor>`，游标按轮询开始时间前推 5 秒（`src/sources/poll.ts:23` `cursorAt`）。当 GitHub 通知索引晚于游标、或评论落在两次轮询的边界时，`since` 已经越过该评论，之后永远不会再被读到。5 秒重叠窗口不足以覆盖索引延迟。
- 这不是“模型没看见”，而是**控制面把消息丢了**。对用户而言，表现就是“@ 了没反应，只能再 @ 一次”。

**影响**：直接违背“take as little human attention as possible”；一次丢消息就让人类多花 4 次操作、多等 4.5 小时。这是当前最该修的问题。

### P0-2：没有实质人工 review，CI 成为唯一质量门

**事实**：

- 5 个 PR 的 GitHub `reviews` 和 `comments` 均为 **0**。
- `#267`（1,882 行、36 文件、含多租户隔离与审计链）在 CI 完成后 **3 分钟**被合并。
- `#266`（610 行、改浏览器隔离）2 分钟；`#265`（1,582 行测试）5 分钟；`#268` 2 分钟。
- `main` 分支未开启 protection（`gh api repos/Colin4k1024/xiangzi/branches/main/protection` 返回 `Branch not protected`），因此 merge 不要求任何 approval；review 记录自然为 0。

**影响**：

- CI 只能证明“作者写的测试通过”，不能证明“验收标准被正确理解”“设计取舍正确”“没有引入未覆盖的回归”。
- 对 `#255`/`#254` 这种安全边界改动，0 review 尤其危险：`#255` 的 `bot_id` 缺省仍退化为 `default` 会话，这是有意的向后兼容，但也是一个“调用方忘传参数就共享身份”的脚枪；没有人独立挑战这个取舍。
- 项目哲学明确写着“Own what it says. Read what the agent posts in your name.” 当前实践没有做到。

> 这不是 agent 的错，但它说明**系统没有把“人工 review”变成结构性的门**，只靠 operator 自觉。对“团队级 superagent”来说，这是不可放大的。

### P1-1：一个被删除的 issue 能让健康状态永久变红

**事实**（评估时 `./scripts/dsh-superagent status`）：

```
health.github = "error"
"111 consecutive failed polls; last: Error: 7 GitHub reads failed:
 github:243: Error: gh: Not Found (HTTP 404);
 github:256: ... EOF;
 github:262: ... EOF"
```

- `#243` 是测试 issue，已被删除；但它的 thread 仍在订阅列表中，`pollError` 为 `Error: gh: Not Found (HTTP 404)`。
- 代码只把 **410** 当作“已删除”（`src/sources/github.ts:158` 的 `deleted(error)` 判断），GitHub 对不可见/已删除 issue 实际返回 **404**，于是每轮都失败。
- 订阅在 ticket 结束后仍保留，轮询地平线是 14 天（`src/sources/poll.ts:6`），所以这个 404 会持续污染健康状态。
- 每轮还会附带 `#256`/`#262` 的偶发 EOF，进一步放大失败计数。

**影响**：

- 当前 intake 未必完全停摆（`pollRound` 会先跑完各步骤再抛错），但**健康信号已经失去意义**：operator 无法区分“真的挂了”和“一个已删除的测试 issue 在刷 404”。
- 每轮重复读、重复报错，浪费 API 配额，也让面板长期红灯。
- 这是“可运维性”问题，不是模型问题，但会直接毁掉“无人值守”的信任。

### P1-2：损坏的 session 日志会拖垮整个 profile 的启动

**事实**（`.artifacts/dsh-superagent-superagent-20261104-095813-57827.log`）：

```
workspace (@deepseek-ai/dsh-workspace): Error: corrupt session log
".../orchestrator-...bak-1793757484/session.v4.jsonl.zstd":
header id "orchestrator-..." and cwd identify ".../orchestrator-..." 
...
session-controller: pending (waiting for service: workspaceRegistry)
schedule: pending (waiting for service: sessionController)
workspace-controller: pending ...
ui-deliverables: pending ...
dsh-superagent: pending ...
```

- 一个备份目录（`.bak-*`）被会话扫描当成正式 session；header 里的 id 与目录名不一致，`assertStoredIdentity` 直接失败。
- 连锁反应：`workspaceRegistry` 失败 → `sessionController` 等待 → `schedule`、`workspace-controller`、`ui-deliverables`、`dsh-superagent` 全部 pending。
- 从行为看没有自动隔离/跳过损坏日志的机制；实际恢复依赖人工处理损坏目录（当前该备份已被移到 `~/.dsh/session-backups/`）。

**影响**：一次备份/恢复/异常退出就可能让整个 superagent 起不来，且报错对普通 operator 不友好。这是“单点脆性”。

### P1-3：评估层超时会直接丢掉请求

**事实**：

- 2026-11-04 有 2 条 `decision.kind = unavailable`、`reason.code = timeout`（01:22:02、01:52:20）。
- 配置 `eval.timeoutSeconds = 120`；首个 ticket 直到 02:04 才创建，此前只能靠人工重试。
- 其余 36 条决策没有再出现 timeout，说明可能是冷启动/模型慢/主会话忙导致的早期不稳定，但机制上仍然会丢。

**影响**：在“接单”这一层，超时不是“稍后重试”，而是 `unavailable`；如果人类不重发，请求就消失。对 SLA 是硬伤。

### P1-4：能力覆盖有明显空白，但报告容易把它读成“全能”

已配置/已实现但**没有被实际验证**的能力：

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 并发工单（`maxWorkers=3`） | 未验证 | 6 个工单的启动时间完全串行；没有两个 ticket 同时 running |
| Feishu 源 | 未验证 | 设置里只有 `sources.github`；没有 Feishu 触发记录 |
| 主动模式（proactive） | 仅 observe | `eval.mode = "observe"`；0 个主动 ticket；30 条非人类触发全部 ignore |
| 自动合并 | 未使用 | 5 个 PR 全部人工 merge；没有 auto-merge 记录 |
| Panel/审批 UI | 未评估 | 本次只读取 API/DB，没有做 UI 走查 |
| 多仓库 | 未验证 | 只配置 `Colin4k1024/xiangzi` |
| 非 GitHub 来源 | 未验证 | 同上 |

**影响**：当前证据只能支持“单仓库、单用户、人工合并”的结论；任何“多团队/多仓库/主动运行”的对外表述都超出实测。

### P2-1：上下文与轮询成本偏高

- 5/6 个 worker 会话峰值上下文 174k–198k，4 个触发 1–2 次 compaction；`#257` 只是文档任务也到 197.5k。
- `#254`：904 step、929 工具调用、287 次 `job_output`、22 次 `job_kill`、125.5M cache-read。
- `#257`：203 次 bash、129 次读文件、73 次 grep，只为产出一份 597 行文档。
- 大量 `sleep 90/120/240` + `gh pr checks` 轮询，而不是等待 CI 事件或后台任务完成通知。

**影响**：时间和 token 成本高；上下文接近上限时，早期读到的细节可能被 compaction 压缩掉，长任务的后半段容易“忘事”。目前靠任务规模还没出事，但不可持续。

### P2-2：默认 binding 是 fail-open 的

`#255` 的实现（`services/browser-worker/src/binding.ts`）：

- `undefined` / `null` 的 `bot_id` → `DEFAULT_BINDING = "default"`；
- 只有“显式传入但为空/非法”才 `fail closed`。

这是 issue 明确要求的“单身份回归”，但对多 Bot 场景是一个脚枪：**任何调用方忘传 `bot_id`，就会静默共享默认会话**，而不是报错。多租户隔离的强度取决于“每个调用点都记得传”，而不是协议强制。

**建议**：给多 Bot 部署加一个“必须显式声明身份”的模式；或在服务端按 deployment 配置决定“缺省是否允许”。至少在测试里加一条“多 Bot 模式下缺省必须失败”的负向用例。

### P2-3：worker 拥有宿主机的完全权限

- `src/app/sessions.ts:152` 明确设置 `danger-full-access`；`docs/003-execution.md` 也写明“Executor Sessions run commands without approval as the operator's OS user … 这些 wrapper 不是安全边界，worker 仍可用绝对路径执行程序”。
- 这意味着：一旦 GitHub issue/PR 内容里藏有提示注入，或允许列表里的账号被盗，worker 可以在 operator 的 Mac 上读写任意文件、执行任意命令。
- 本次没有发现实际越权行为；agent 也只用了 repo 内路径和 `gh`。但作为“团队级”部署，这是不能接受的信任模型。

### P2-4：没有跨工单记忆/学习

- 每个 ticket 都是新的 worktree + 新 session；没有把“这个仓库怎么跑测试、哪些测试会 flake、ADR 在哪、代码风格是什么”沉淀成可复用记忆。
- 结果是每个工单都重新探索一遍：`#257` 203 次 bash、`#254` 509 次 bash；同类命令在多个工单重复出现。
- 也没有“从 review comment 学习”的闭环（因为根本没有 review comment）。

### P2-5：大 diff + 无 review = 隐性风险

- `#267` 36 文件 / 1,882 行，其中不少文件只是机械地补 `actor_bot: None`；这类改动本身没错，但会把真正的设计改动淹没在噪音里，增加 review 成本。
- 没有 review 的情况下，“CI 绿 + PR 描述自洽”就成了唯一证据；一旦描述与实现有偏差，没有人会发现。

### P3：环境/网络/CI 抖动

- 首个 ticket 的 prepare 命令失败：`Failed to connect to github.com port 443 after 75000 ms`；prepare 命令里硬编码了 `http://127.0.0.1:7890` 代理，代理不可用就会全线失败。
- `#255` 会话里 `curl` 两次 exit 28（超时）；`#256`/`#262` 轮询出现 EOF。
- `#262` 的 `cargo test` 首次因共享 Postgres 连接池超时失败，rerun 后通过；`#268` 有 3 次 CI 取消/重跑（force-push）。
- 这些不是 agent 的逻辑错误，但说明“本机 + 代理 + 共享测试库”的环境不够稳，会影响交付时间。

---

## 6. 设计 vs 实测：哪些能力真的被证明了

| 设计能力 | 设计文档 | 实测 | 结论 |
| --- | --- | --- | --- |
| GitHub 触发/订阅 | 有 | 5 个工单走通；6 条 mention 丢失 | **部分证明，可靠性不合格** |
| 授权/allowlist/robot 过滤 | 有 | 30/30 非人类触发 ignore；6 个显式 accept | **证明** |
| 工单生命周期/状态机 | 有 | 6 个 ticket 全部正确结束（5 merged / 1 completed） | **证明** |
| worktree 隔离/prepare | 有 | 6 个 worktree 创建成功；1 次网络失败后重试 | **基本证明** |
| 并发（maxWorkers=3） | 有 | 实际并发 1 | **未证明** |
| 长任务/后台 job/30 分钟上限 | 有 | `#254` 68 分钟、904 step；22 次 job_kill | **部分证明** |
| 恢复/重试 | 有 | prepare 失败可重试；eval 超时靠人工重发；丢 mention 无自愈 | **弱** |
| 交付/outbox | 有 | 13/13 sent，0 dropped | **证明** |
| 主动评估（observe） | 有 | 0 个主动 ticket；30 条 ignore | **未证明价值** |
| Feishu | 有 | 未配置/未使用 | **未证明** |
| Panel | 有 | 未走查 | **未证明** |
| 自动合并 | 有（默认关） | 未使用 | **未证明** |
| 记忆/学习 | 无/弱 | 无跨工单记忆 | **缺失** |

---

## 7. 根因分析

### 7.1 为什么“写代码”看起来很强，而“接单”很弱

这是两套不同的反馈回路：

- **写代码**有强反馈：编译器、测试、clippy、CI、PR 模板。模型可以在几十分钟内迭代到绿，且错误会立刻暴露。
- **接单**没有强反馈：消息丢了不会报错，人类不重发就永远不知道；健康状态又被 404 噪音污染。控制面的失败是“沉默的”，所以看起来“模型很强，系统偶尔抽风”。

结论：**当前瓶颈在控制面，不在模型**。把同样的模型放到一个可靠的消息队列/工单系统上，表现会明显更稳。

### 7.2 为什么 review 没有发生

- 没有强制门：CI 绿即可 merge，review 不是必需；
- agent 的 PR 描述太好，容易让人产生“已经审过了”的错觉；
- 合并动作只要 2–5 分钟，说明 operator 的路径是“看 CI → 点 merge”，而不是“读 diff → 对照验收”；
- 缺少“review  checklist / 风险分级 / 大 diff 必须二审”的机制。

结论：**不是 operator 不负责，而是系统没有把负责变成低成本动作**。需要把“review”产品化，而不是写进哲学文档。

### 7.3 为什么健康状态会长期红

- 线程订阅在 ticket 结束后继续保留 14 天；
- 删除的 issue 返回 404，而代码只识别 410；
- 单线程失败被计入整轮失败，`failuresBeforeError` 只控制“何时报错”，不控制“何时丢弃”；
- 没有“按 thread 的失败预算/自动退订”。

结论：健康模型缺少“坏线程隔离”和“失败预算”，一个坏输入可以长期污染全局信号。

### 7.4 为什么上下文总是接近 200k

- 每个 step 都带完整对话 + 工具结果；
- 没有中间总结/分层记忆；
- 长任务靠 compaction 硬压；
- 很多 token 花在重复读同一批文件、轮询同一批 job。

结论：**单线程、全上下文、轮询式执行**是成本结构的根因；不是模型窗口不够大，而是没有做上下文工程。

---

## 8. 建议路线图

### P0（先修，1–2 周）：让“接单”和“评审”可信

1. **修触发丢失**
   - 把 `since` 重叠窗口从 5 秒提高到至少 5–10 分钟，或改为“按 comment id 去重 + 最近 N 小时回扫”；
   - 增加一个独立的 mention 扫描（不依赖 notifications 的 `since`），例如对最近活跃 issue 直接列 comments；
   - 加一条端到端 canary：定时由一个允许账号发一条测试 mention，断言 2 分钟内出现 trigger；
   - 指标：`mention → trigger` 捕获率 100%（20 次测试），p95 确认 < 2 分钟。

2. **把 review 变成结构门**
   - 对 `agent/*` 分支启用 branch protection，至少 1 个 human approval；
   - `>200 行` 或涉及安全边界（auth/isolation/audit）的 PR 强制二审；
   - PR 模板加“验收标准逐条对照”和“风险等级”；
   - 指标：0 个无 review 合并；大 diff 100% 二审。

3. **删除线程不再毒化健康**
   - 把 404 视作“不可读/已删除”，连续 2 次后自动退订或标记 `dropped`；
   - 给每个 thread 设失败预算（例如 3 次/24h），超过后只记录、不参与全局 health；
   - 指标：删除一个测试 issue 后，health 仍为 ready；无重复 404 读。

### P1（2–4 周）：让运行时可恢复、可放大

4. **启动隔离损坏 session**
   - 扫描时忽略 `.bak`、`.tmp`、非 session 命名目录；
   - header id 与目录名不一致时自动移到 `corrupt/` 并继续启动；
   - 指标：放入一个损坏日志，profile 仍能 ready。

5. **评估超时不再丢请求**
   - 120s 改为自适应（按模型/上下文），失败自动重试 1 次；
   - 仍失败则把 trigger 留在队列并通知 operator，而不是 `unavailable` 消失；
   - 指标：超时请求 0 丢失。

6. **并发与隔离实测**
   - 同时投 3 个工单（不同文件域），验证 worktree、端口、DB、job 不互相污染；
   - 引入 merge queue / 冲突检测；
   - 指标：3 并发全部成功，0 交叉污染。

7. **加跨工单记忆**
   - 每仓库一份 profile：构建/测试命令、flaky 测试、ADR 索引、代码风格、常见坑；
   - 工单开始时注入，而不是每次重新探索；
   - 指标：发现类命令减少 30%，首 PR 时间缩短 20%。

8. **安全边界**
   - 团队部署时，worker 放容器/独立用户，限制 egress 和 secret 读取；
   - 本机模式保留 `danger-full-access`，但明确标注“仅限个人可信环境”；
   - 指标：提示注入演练无法读取 `~/.ssh` / 凭证。

### P2（1–2 个月）：效率与“superagent”形态

9. **减少轮询与上下文**
   - CI 用 webhook/`gh run watch` 替代 `sleep + gh pr checks`；
   - 后台 job 用完成通知，而不是 287 次 `job_output`；
   - 大任务用子 agent 并行调研/测试；
   - 指标：单工单 token/step 降低 30%。

10. **主动模式小规模试点**
    - 在 1 个仓库开 suggest-only，记录“它本来会做什么”， measure 接受率/噪音；
    - 指标：4 周内 ≥10 个建议，接受率 ≥30%，人类打扰 ≤1 条/周。

11. **多源/多仓库**
    - 先 Feishu 单群，再第二仓库；
    - 指标：跨源触发不丢、权限不串。

12. **可观测/SLO**
    - 面板增加：mention 捕获率、接单 p95、交付 p95、review 覆盖率、rework 率、每单 token/成本、health 真实错误；
    - 指标：任何一项连续 3 天越界自动告警。

### 30 天验证计划（建议）

| 周 | 动作 | 通过标准 |
| --- | --- | --- |
| 第 1 周 | 修 P0-1/2/3；20 次 mention canary | 捕获 20/20；0 无 review 合并；删除 issue 不红灯 |
| 第 2 周 | 10 个明确 issue + 5 个模糊 issue | 明确任务 ≥90% 一次通过；模糊任务能提出正确澄清问题 |
| 第 3 周 | 3 并发 + 第二仓库 + Feishu 单群 | 无交叉污染；跨源不丢；权限不串 |
| 第 4 周 | 100% review 审计 + 安全演练 + 成本复盘 | 0 高危；单工单成本/时延达标；决定是否放大 |

### “可以放大”的验收线

- trigger 捕获率 ≥95%，p95 确认 <2 分钟；
- 交付成功率 ≥95%，rework <5%；
- 100% PR 有独立 review（人或独立模型）；
- 3 并发无交叉污染；
- 0 起宿主安全事件；
- 模糊需求成功率 ≥70%；
- 人类注意力 ≤2 条消息/工单。

---

## 9. 适用边界与最终判断

### 现在适合用它做什么

- **单仓库、边界清晰、有验收标准**的工程任务：文档纠偏、测试补齐、明确的 ADR/issue 实现；
- **低风险、可回滚**的改动，且有 CI 兜底；
- **一个人维护的仓库**，operator 愿意在合并前花 5–10 分钟读 diff；
- **作为“高级实习生/结对工程师”**，而不是“无人值守的团队代理”。

### 现在不适合做什么

- **团队级无人值守**：没有强制 review，没有安全沙箱，没有可靠的 mention 捕获；
- **模糊/冲突需求**：没有证据表明它会正确澄清，而不是自行补全；
- **多仓库/多租户/多来源**：未验证；
- **安全边界改动**（auth、隔离、审计、支付）：当前 0 review 的实践不可接受；
- **把“CI 绿”当成“可以发布”**：它自己都在 PR 里写“未做真实端到端”，不要替它升级结论。

### 最终判断

**这是一次成功的原型验证，但不是一次成功的“superagent”验证。**

- 作为 **issue→PR 工程代理**：**A−**。理解、实现、验证、交付都达到了可用的高级工程师水平；PR 说明的诚实度尤其难得。
- 作为 **superagent**：**C+**。它还没有证明自己能可靠地接住人的意图、在没有人的情况下守住质量、在出问题时自愈；它现在的“强”很大程度上来自**输入的高质量**和**人类的最后一道 merge**。
- 最值得保留的资产：**领域模型 + prompt 体系 + 诚实报告习惯**。
- 最该补的短板：**intake 可靠性、独立 review、健康/恢复、记忆**。

如果只能做一件事：**先修“丢 mention”**。因为它直接违背了这个项目的第一性原理——用最少的人类注意力换取最大的价值。一个会让人重复 @ 四次的 agent，能力再强也会消耗信任。

---

## 10. 修复落地与复测（2026-11-06 17:20）

评估中的三个 P0 已按“先优化”落地，并做了可验证的复测。

### 10.1 丢 mention

- `mentionLookbackSeconds` 默认 900 秒：通知游标、通知读取和线程读取都回看 15 分钟；Trigger ID 去重保证重复读无副作用。
- 新增仓库级 mention sweep：每轮读 `issues/comments` 与 `pulls/comments`，只把“提到智能体、非智能体自己、尚未存储”的评论变成 Trigger；sweep 失败只记 warning，不污染健康。
- 新增 `scripts/mention-canary.mjs`：在专用 canary Issue 上发带唯一标记的 @，等待 agent 回复，输出每次延迟、p95 和 20/20 捕获结果；dry-run 已测试。
- 复测：新增 sweep 单测（通知为空、评论最近、非提及与 agent 自己的评论被忽略）和 404 隔离/恢复测试；全量 1,210 个测试通过。

### 10.2 Review gate

- `main` 已启用 branch protection：至少 1 个非作者 approval、push 后旧 approval 失效、要求最后一次 push 后的 approval、禁止 force push/删除、要求 conversation resolution。`enforce_admins=false`，所以管理员可应急绕过，agent 账号不能。
- 二审规则已实现为独立 workflow：`examples/github/review-gate.mjs` + `.yml` + `.json`。超过 200 行或命中 auth/oauth/audit/policy/approval/isolation/binding/migrations 路径时要求 2 个 approval；作者自己的 approval 不计；取每个 reviewer 的最新状态。规则已单测覆盖。
- 安装与启用命令在 `docs/009-review-gate.md`；`scripts/apply-review-gate.sh --require-check` 在 workflow 合入并跑过一次后把 `review-gate` 设为必需检查。当前二审 workflow **尚未**合入 xiangzi，所以线上只强制 1 个 approval；二审是“已实现、待安装”，不是“已生效”。
- 不直接启用二审的原因：xiangzi 目前只有 `Colin4k1024` 一个人类账号和 `xiangzi-agent` 一个写权限账号。agent 不能批准自己开的 PR；只有 1 个人类 reviewer 时，>200 行/敏感路径的 PR 会永久卡在“需要 2 个 approval”。先增加第二个可审批的人类账号，再安装并 required 二审 workflow。
- 为什么保护 `main` 而不是 `agent/*`：保护 `agent/*` 会阻止 agent 推送自己的分支；需要人把关的是合并目标，不是 agent 的工作分支。文档已写明。

### 10.3 删除线程与损坏 session

- 订阅线程连续 `threadFailuresBeforeQuarantine`（默认 3）次 404 后隔离：停止轮询、记录 `pollSuspended`、在健康 detail 里点名，但不计入 failed poll；新 mention/notification 成功后自动恢复。通知重试同样在 3 次 404 后隔离。
- 复测：`github:243` 当前 `pollSuspended=1`、`pollFailures=3`；Source 健康从 `error` 变为 `ready`，detail 为 `quarantined after repeated reads failed: #243`。线上进程已重启并以新构建运行。
- 新增 `scripts/session-preflight.py`：启动前把 `.bak-*`、`.tmp*`、点开头的 session 目录，以及 header id 与目录名不一致的 session 移到 `$DSH_HOME/session-quarantine/<timestamp>/`；只读 session 日志第一行并终止 zstd，避免解压整份日志。启动器 `scripts/dsh-superagent` 在 start 前调用它；失败只警告、不阻塞启动。
- 复测：`python3 scripts/session-preflight.py --dry-run` 检查 197 个 session，0 个误移；单测覆盖 `.bak`、header mismatch、dry-run。

### 10.4 当前验证结果

- `pnpm check`：typecheck、1,210 个测试、`tsdown` 构建全部通过。
- 线上 `./scripts/dsh-superagent status`：`github: ready`。首轮隔离时 detail 为 `quarantined after repeated reads failed: #243`；重启后该线程被直接跳过，detail 回到 `0 notifications`，`github:243` 仍保持 `pollSuspended=1`。
- 远端 `main` 的 protection 已生效：`required_approving_review_count=1`、`dismiss_stale_reviews=true`、`require_last_push_approval=true`、`enforce_admins=false`。

### 10.5 还没做的

- 二审 workflow 尚未安装到 xiangzi；安装后运行 `scripts/apply-review-gate.sh --repo Colin4k1024/xiangzi --require-check` 才会把 `review-gate` 变成必需检查。
- mention canary 还没有在专用 Issue 上跑 20 次；脚本与 dry-run 已就绪，需要先建一个专用 canary Issue。
- 3 工单并发、Feishu、多仓库仍未验证；这些是报告的 P1/P2，不在本次三个 P0 内。

## 附录 A：证据索引

| 证据 | 位置 |
| --- | --- |
| 工单/决策/触发/outbox | `~/.dsh/state/superagent/orchestrator.sqlite`（表 `ticket`、`decision`、`trigger`、`trigger_thread`、`thread`、`outbox`） |
| 6 个 worker 会话 | `~/.dsh/sessions/--Users-fanjia-.dsh-state-superagent-work-*/worker-*/session.v4.jsonl.zstd` |
| 编排器会话 | `~/.dsh/sessions/--Users-fanjia-.dsh-state-superagent--/orchestrator-*/session.v4.jsonl.zstd` |
| 当前健康 | `./scripts/dsh-superagent status`（2026-11-06 16:45 CST） |
| 启动故障 | `.artifacts/dsh-superagent-superagent-20261104-095813-57827.log` |
| 通知轮询实现 | `src/sources/github.ts:298`（`pollNotifications`）、`src/sources/poll.ts:23`（`cursorAt`） |
| 删除线程处理 | `src/sources/github.ts:429`（`pollThreads`，注释只提 410） |
| 轮询失败聚合 | `src/sources/github.ts:289` |
| worker 权限 | `src/app/sessions.ts:152`（`danger-full-access`）、`docs/003-execution.md`（“not a security boundary”） |
| 哲学/责任 | `docs/000-philosophy.md` |
| 自动合并默认 | `prompts/team/delivery.md` |

## 附录 B：会话明细

| Worker | 工单 | step | 工具调用 | 错误 | 峰值上下文 | compaction | 墙钟 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `worker-2a1e50ff…` | `#256` | 244 | 263 | 1 | 196,948 | 1 | 73 min |
| `worker-2c842817…` | `#259` | 260 | 291 | 2 | 196,804 | 1 | 37 min |
| `worker-cabf99c4…` | `#255` | 181 | 229 | 7 | 174,217 | 0 | 28 min |
| `worker-669b02f9…` | `#254` | 904 | 929 | 14 | 196,921 | 2 | 70 min |
| `worker-c4635604…` | `#257` | 260 | 323 | 4 | 197,573 | 1 | 43 min |
| `worker-5315f32e…` | `#243` | 13 | 14 | 0 | 29,938 | 0 | 1 min |

## 附录 C：健康输出（节选）

修复前（评估时）：

```json
{
  "health": { "github": "error" },
  "errors": { "github": "111 consecutive failed polls; last: 7 GitHub reads failed: github:243: 404; github:256: EOF; github:262: EOF" }
}
```

修复后（2026-11-06 17:20，重启并跑完 3 轮后）：

```json
{
  "health": { "github": "ready" },
  "errors": {},
  "detail": "0 notifications; next poll ≥ 60s; quarantined after repeated reads failed: #243"
}
```

再次重启后（17:24），已隔离的 `#243` 被直接跳过，detail 回到 `0 notifications; next poll ≥ 60s`；thread 的
`pollSuspended` 仍为 1，说明隔离是持久的，不是靠当前一轮的报错文本。

## 附录 D：评估时的仓库状态说明

评估以 `Colin4k1024/xiangzi` 的**已合并提交和 PR**为准。评估时该仓库工作区存在未提交改动（`git status`：71 个文件，约 +465/−5,433），其中包含对部分 agent 产出的删除/回退。该状态不属于已合并历史，未纳入本报告结论；如果这是有意的回滚，需要以回滚后的分支重新验证运行时行为。

---

*报告生成：2026-11-06 · 基于实测数据，不构成对 DeepSeek 官方产品的评价。*
