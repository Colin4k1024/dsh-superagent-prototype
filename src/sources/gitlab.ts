/** GitLab source kind skeleton: configuration, panel fields, policy part, health and plugin entry; polling arrives in Phase 2. */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { type Thread, type Ticket } from '../core/index.ts'
import { GitlabAccountsSchema, type Deployment } from '../deployment.ts'
import { CliError } from '../infra/commands.ts'
import { KV } from '../kv.ts'
import type { ForgePort } from './forge.ts'
import { gitlabLink, sendGitlab } from './gitlab-channel.ts'
import { claimChange, mergeChange, numbersOf as mrNumbers, observeChange, readChange, snapshotOf, terminalNotices } from './gitlab-mr.ts'
import { ciCounts, ciFailures, ciSummary, gitlabChecks, gitlabRepositoryRead, gitlabThreadContext, readApprovals, readBranchPipeline,
  readDefaultBranch, readDiscussions, readIssues, readJobs, readMergeRequest, readMergeRequests, readNotes, readTodos } from './gitlab-read.ts'
import { approvalTrigger, branchPipelineTrigger, issueTrigger, mergeRequestPipelineTrigger, mergeRequestTrigger, noteTrigger, type ItemKind } from './gitlab-trigger.ts'
import { changeRef, gitlabPage, itemThread, SOURCE } from './gitlab-trigger.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import { cursorAt, pause, pollThreads as pollEach } from './poll.ts'
import type { Localized, SourceKind } from './kind.ts'

export { SOURCE, itemThread, gitlabPage } from './gitlab-trigger.ts'
const GitlabConfigSchema = GitlabAccountsSchema.extend({
  pollSeconds: z.number().int().min(60).max(3600).default(60),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  mentionLookbackSeconds: z.number().int().min(60).max(3600).default(900),
  threadFailuresBeforeQuarantine: z.number().int().min(2).max(10).default(3),
  observeIssues: z.boolean().default(false),
  observeMrs: z.boolean().default(false),
  observeComments: z.boolean().default(false),
  observeCi: z.boolean().default(false),
  autoLabels: z.array(z.string().trim().min(1)).default(['agent-ready']),
}).strict()
export type GitlabConfig = z.infer<typeof GitlabConfigSchema>

/** Phase 2 fills these methods; the skeleton only lets tickets and cards recognize a GitLab merge request. */
export const gitlabForge: ForgePort = {
  kind: SOURCE,
  changeWord: 'MR',
  pageUrl: (project, ref, host = 'https://gitlab.com') => gitlabPage(host, project, 'mr', ref.number),
  change: {
    parse: changeRef,
    read: readChange,
    claim: claimChange,
    observe: observeChange,
    numbersOf: mrNumbers,
    terminalNotices,
    merge: mergeChange,
  },
  checks: gitlabChecks,
  repositoryRead: gitlabRepositoryRead,
}

const OBSERVED = { issues: 'observeIssues', mrs: 'observeMrs', comments: 'observeComments', ci: 'observeCi' } as const
type ScopeRow = keyof typeof OBSERVED
const scopeOf = (meta: Record<string, unknown>): ScopeRow | undefined =>
  meta.event === 'ci' ? 'ci'
  : meta.event === 'note' || meta.event === 'approval' ? 'comments'
  : meta.item === 'mr' ? 'mrs' : meta.item === 'issue' ? 'issues' : undefined
const labelsOfMeta = (meta: Record<string, unknown>): string[] => Array.isArray(meta.labels) ? meta.labels.map(String) : []
/** A labelled Issue/MR is observed; a note or approval follows the comments switch. `@` still makes a message explicit. */
const observed = (row: ScopeRow, meta: Record<string, unknown>, config: GitlabConfig): boolean => {
  if (row === 'ci') return config.observeCi
  if (row === 'comments') return config.observeComments
  const labels = labelsOfMeta(meta)
  return (row === 'issues' ? config.observeIssues : config.observeMrs) && labels.some(label => config.autoLabels.includes(label))
}
const scope = ({ meta }: { meta: Record<string, unknown> }, config: GitlabConfig): { listened: true; observed: boolean; row?: string } => {
  const row = scopeOf(meta)
  return row ? { listened: true, observed: observed(row, meta, config), row } : { listened: true, observed: false }
}
/** `!12` names a merge request and `#12` an Issue; a URL needs the configured host/project and is left to the Source reader. */
function findThread(query: string): { threads: string[]; terms: string[] } {
  const value = query.trim()
  const mr = /^!(\d+)$/.exec(value)?.[1]
  const issue = /^#(\d+)$/.exec(value)?.[1]
  return { threads: mr ? [`${SOURCE}:${itemThread('mr', Number(mr))}`] : issue ? [`${SOURCE}:${itemThread('issue', Number(issue))}`] : [], terms: [] }
}

export const gitlabKind: SourceKind<GitlabConfig> = {
  kind: SOURCE,
  title: { zh: 'GitLab', en: 'GitLab' },
  description: { zh: '智能体的 GitLab 账号；接收项目里发给它的 Issue、MR、评论、审批和流水线变化。', en: 'The agent\'s GitLab account; receives Issues, merge requests, comments, approvals and pipeline changes in the project.' },
  schema: GitlabConfigSchema,
  fields: [
    { key: 'host', type: 'text', label: { zh: 'GitLab 地址', en: 'GitLab URL' },
      hint: { zh: '自建实例写 https://gitlab.example.com；gitlab.com 写 https://gitlab.com。', en: 'Use https://gitlab.example.com for self-managed, or https://gitlab.com.' } },
    { key: 'project', type: 'text', pattern: '[A-Za-z0-9_.\\-]+(/[A-Za-z0-9_.\\-]+)+', label: { zh: '监听的项目', en: 'Project' },
      hint: { zh: '写作 group/subgroup/project。保存时检查智能体账号能否以 Developer 及以上角色推送到它，然后重启 dsh-superagent。', en: 'Written group/subgroup/project. Saving checks that the agent account can push to it as Developer or above, then restarts dsh-superagent.' } },
    { key: 'cli', type: 'text', label: { zh: '智能体的 GitLab CLI', en: 'Agent GitLab CLI' },
      hint: { zh: '命令名或绝对路径，通常是用 GLAB_CONFIG_DIR 登录智能体账号的 glab 包装脚本。', en: 'A command name or absolute path, usually a glab wrapper signed in to the agent account through GLAB_CONFIG_DIR.' } },
    { key: 'commitEmail', type: 'text', label: { zh: '提交邮箱', en: 'Commit email' },
      hint: { zh: '留空时用 glab 账号的邮箱；自建实例没有 GitHub 的 noreply 规则，建议显式填写。', en: 'Empty uses the glab account email; self-managed GitLab has no GitHub noreply rule, so an explicit value is safer.' } },
    { key: 'mergeCli', type: 'text', advanced: true, label: { zh: '宿主合并 CLI', en: 'Host merge CLI' },
      hint: { zh: '仅宿主使用的 Maintainer glab 包装脚本；worker 看不到它。留空时由人工合并。', en: 'A Maintainer glab wrapper used only by the host; workers never see it. Empty means a person merges.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 60, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' } },
    { key: 'mentionLookbackSeconds', type: 'number', advanced: true, min: 60, max: 3600, label: { zh: '提及回看窗口 / 秒', en: 'Mention lookback / seconds' } },
    { key: 'threadFailuresBeforeQuarantine', type: 'number', advanced: true, min: 2, max: 10, label: { zh: '线程连续失败几次后隔离', en: 'Thread failures before quarantine' } },
    { key: 'observeIssues', type: 'switch', label: { zh: '接收项目里的新 Issue', en: 'Receive new Issues in the project' },
      hint: { zh: '打开后，带 autoLabels 标签的未 @ Issue 会成为推断候选；由策略的接收表决定是否接单。', en: 'New Issues carrying an autoLabels label become inferred candidates; the Policy admission table decides whether they are accepted.' } },
    { key: 'observeMrs', type: 'switch', label: { zh: '接收项目里的新 MR', en: 'Receive new merge requests in the project' } },
    { key: 'observeComments', type: 'switch', label: { zh: '接收项目里的评论', en: 'Receive comments in the project' } },
    { key: 'observeCi', type: 'switch', label: { zh: '接收默认分支的流水线', en: 'Receive the default branch pipeline' } },
    { key: 'autoLabels', type: 'rows', advanced: true, label: { zh: '可自动接单的标签', en: 'Labels that may auto-accept' },
      columns: [{ key: 'id', type: 'text', label: { zh: '标签', en: 'Label' }, pattern: '[A-Za-z0-9_.:-]+' }] },
  ],
  health: [SOURCE],
  capabilities: { forge: gitlabForge },
  channel: { send: sendGitlab, link: gitlabLink },
  threadContext: gitlabThreadContext,
  scope,
  find: query => findThread(query),
  facts: (deployment?: Deployment): Record<string, Localized | string> => deployment?.forge.kind === 'gitlab'
    ? { cli: { zh: `当前账号 @${deployment.forge.login}`, en: `Current account @${deployment.forge.login}` } } : {},
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_.-]+$/), name: z.string().trim().max(100).optional() }).strict()).default([]),
      bots: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_.-]+$/) }).strict()).optional() }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的 GitLab 账号', en: 'GitLab accounts that may originate work' },
      columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9_.\\-]+' }] },
    { key: 'bots', type: 'rows', label: { zh: '评论可以成为候选的机器人', en: 'Bots whose comments may become candidates' },
      columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9_.\\-]+' }] }],
    explicit: { zh: '名单里的账号在 Issue 或评论里 @ 智能体。', en: 'An account on the list mentions the agent in an Issue or a comment.' },
    rows(stored) {
      const config = GitlabConfigSchema.partial().parse(stored)
      const labels = config.autoLabels?.join(', ') || '—'
      const note = (on: boolean | undefined, automatic = false) => !on ? { zh: '仅 @', en: '@ only' }
        : automatic ? { zh: `仅带 ${labels} 的 Issue/MR`, en: `Only Issues/MRs labelled ${labels}` } : { zh: '全部', en: 'All' }
      const row = (id: ScopeRow, label: Localized) => ({ id, label, note: note(config[OBSERVED[id]], id === 'issues' || id === 'mrs'),
        cells: { listedUnaddressed: !!config[OBSERVED[id]], unlistedAddressed: true, unlistedUnaddressed: !!config[OBSERVED[id]] } })
      return [row('issues', { zh: '新 Issue', en: 'New Issues' }), row('mrs', { zh: '新 MR', en: 'New merge requests' }),
        row('comments', { zh: '评论', en: 'Comments' }),
        { id: 'ci', label: { zh: '默认分支流水线', en: 'Default branch pipeline' }, note: config.observeCi ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: !!config.observeCi } }]
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_GITLAB_HOST', description: { zh: 'GitLab 实例地址，例如 https://gitlab.example.com', en: 'The GitLab instance URL, such as https://gitlab.example.com' } },
      { key: 'DSH_SUPERAGENT_GITLAB_PROJECT', description: { zh: '这个来源监听的项目，group/subgroup/project', en: 'The project this Source watches, as group/subgroup/project' } },
      { key: 'DSH_SUPERAGENT_GITLAB_ACCOUNT', description: { zh: '智能体的 GitLab 账号；glab 以它登录', en: 'The agent\'s GitLab account, which glab is signed in to' } },
      { key: 'DSH_SUPERAGENT_GITLAB_COMMIT_EMAIL', description: { zh: '智能体账号的提交邮箱', en: 'Commit email of the agent account' } },
      { key: 'DSH_SUPERAGENT_GITLAB_ITEM', description: { zh: '接下工单的 Issue 或 MR，写作 issue:<iid> 或 mr:<iid>；不是从 GitLab 来的时为空', en: 'The Issue or MR that started the ticket, as issue:<iid> or mr:<iid>; empty when it did not start on GitLab' } },
      { key: 'DSH_SUPERAGENT_GITLAB_MR_HEAD', description: { zh: '接下工单的 MR 的 head 引用 refs/merge-requests/<iid>/head；不是 MR 时为空', en: 'Head ref refs/merge-requests/<iid>/head of the MR that started the ticket; empty when it was not an MR' } },
    ],
    values: ({ deployment, trigger }) => {
      const item = trigger?.source === SOURCE && typeof trigger.meta.iid === 'number'
        ? `${String(trigger.meta.item)}:${String(trigger.meta.iid)}` : ''
      return { DSH_SUPERAGENT_GITLAB_HOST: deployment.forge.kind === 'gitlab' ? deployment.forge.host ?? '' : '',
        DSH_SUPERAGENT_GITLAB_PROJECT: deployment.forge.kind === 'gitlab' ? deployment.forge.repository : '',
        DSH_SUPERAGENT_GITLAB_ACCOUNT: deployment.forge.kind === 'gitlab' ? deployment.forge.login : '',
        DSH_SUPERAGENT_GITLAB_COMMIT_EMAIL: deployment.forge.kind === 'gitlab' ? deployment.forge.commitEmail : '',
        DSH_SUPERAGENT_GITLAB_ITEM: item,
        DSH_SUPERAGENT_GITLAB_MR_HEAD: item.startsWith('mr:') ? `refs/merge-requests/${item.slice(3)}/head` : '' }
    },
  },
}

export const name = 'dsh-superagent-gitlab'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(gitlabKind), 'gitlab: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, gitlabKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal).catch((error: unknown) => {
      source.report(SOURCE, { state: 'error', detail: String(error) })
    })
    return async () => { controller.abort(); await running }
  })
}
/** One polling round: project streams, todos, subscribed Threads, then the MRs of open tickets. */
export interface GitlabRound { started: string; received: number }
export async function pollRound(ctx: SourceContext, signal?: AbortSignal): Promise<GitlabRound> {
  const started = new Date().toISOString()
  const commands = ctx.commands.withSignal(signal)
  const round: GitlabRound = { started, received: 0 }
  await pollRepository(ctx, commands, round)
  await pollTodos(ctx, commands, round)
  await pollEach(ctx, SOURCE, () => !!signal?.aborted, thread => pollThread(ctx, commands, thread, round))
  await pollOpenChanges(ctx, commands, round)
  await pollBranchPipeline(ctx, commands, round)
  return round
}

/** Reads the configured project streams from `updated_after`, then each item's notes from its own cursor. */
async function pollRepository(ctx: SourceContext, commands: SourceContext['commands'], round: GitlabRound): Promise<void> {
  const config = ctx.config<GitlabConfig>(SOURCE)
  if (!config) return
  const agent = ctx.deployment.forge.login
  const lookback = config.mentionLookbackSeconds * 1000
  if (config.observeIssues) {
    const stored = ctx.state.get(KV.gitlab.stream('issues'))
    const since = stored?.since ?? cursorAt(round.started, lookback)
    const issues = await readIssues(commands, since)
    for (const issue of issues) {
      if (issue.author.username !== agent && Date.parse(issue.created_at) >= Date.parse(since)) {
        await ctx.receive(issueTrigger(issue, agent)); round.received += 1
      }
      await intakeNotes(ctx, commands, 'issue', issue.iid, issue.web_url, round, lookback)
    }
    ctx.state.set(KV.gitlab.stream('issues'), { since: cursorAt(round.started, lookback), started: stored?.started ?? {} })
  }
  if (config.observeMrs) {
    const stored = ctx.state.get(KV.gitlab.stream('mrs'))
    const since = stored?.since ?? cursorAt(round.started, lookback)
    const mrs = await readMergeRequests(commands, since)
    for (const mr of mrs) {
      if (mr.author.username !== agent && Date.parse(mr.created_at) >= Date.parse(since)) {
        await ctx.receive(mergeRequestTrigger(mr, agent)); round.received += 1
      }
      await intakeNotes(ctx, commands, 'mr', mr.iid, mr.web_url, round, lookback)
      await observeChange(ctx, snapshotOf(mr, ctx.deployment))
    }
    ctx.state.set(KV.gitlab.stream('mrs'), { since: cursorAt(round.started, lookback), started: stored?.started ?? {} })
  }
}

/** Pending todos only wake the reader: the note cursor decides what is new, so a re-read is harmless. */
async function pollTodos(ctx: SourceContext, commands: SourceContext['commands'], round: GitlabRound): Promise<void> {
  const config = ctx.config<GitlabConfig>(SOURCE)
  if (!config) return
  const lookback = config.mentionLookbackSeconds * 1000
  for (const todo of await readTodos(commands)) {
    const iid = todo.target?.iid
    if (!iid) continue
    const kind: ItemKind | undefined = todo.target_type === 'MergeRequest' ? 'mr' : todo.target_type === 'Issue' ? 'issue' : undefined
    if (kind) await intakeNotes(ctx, commands, kind, iid, undefined, round, lookback)
  }
}

/** Reads a subscribed Thread's notes and DiffNotes from its cursor, also outside the repository stream. */
async function pollThread(ctx: SourceContext, commands: SourceContext['commands'], thread: Thread, round: GitlabRound): Promise<void> {
  const config = ctx.config<GitlabConfig>(SOURCE)
  if (!config) return
  const match = /^(issue|mr):(\d+)$/.exec(thread.ref.id)
  if (!match) return
  const kind = match[1] as ItemKind
  const iid = Number(match[2])
  const url = typeof thread.meta.url === 'string' ? thread.meta.url : undefined
  await intakeNotes(ctx, commands, kind, iid, url, round, config.mentionLookbackSeconds * 1000)
  if (kind === 'mr') await observeChange(ctx, await readChange(ctx, { kind: 'change', number: iid }))
}

/** Polls the MRs of open tickets, so a merge or close reaches the Engine even without a new note. */
async function pollOpenChanges(ctx: SourceContext, commands: SourceContext['commands'], round: GitlabRound): Promise<void> {
  const numbers = [...new Set(ctx.tickets.open().flatMap(ticket => mrNumbers(ticket, true)))]
  for (const number of numbers) {
    const mr = await readMergeRequest(commands, number)
    const change = snapshotOf(mr, ctx.deployment)
    await observeChange(ctx, change)
    await pollApprovals(ctx, commands, number, mr, round)
    await pollPipeline(ctx, commands, number, mr, change, round)
  }
}

/** New approvers become Triggers; a revoked approval is simply removed from the known set. The first observation also
 *  emits approvals already present, because a fast approval can land after an MR binds to its ticket but before the first
 *  poll — treating it as a silent baseline would leave a worker waiting for a review that already exists. `previous` stores
 *  only usernames, so a repeat observation after a restart is still deduplicated. */
export async function pollApprovals(ctx: SourceContext, commands: SourceContext['commands'], number: number,
  mr: Awaited<ReturnType<typeof readMergeRequest>>, round: GitlabRound): Promise<void> {
  const approvals = await readApprovals(commands, number)
  const users = approvals.approved_by.map(item => item.user)
  const previous = ctx.state.get(KV.gitlab.approvals(number)) ?? []
  for (const user of users) {
    if (previous.includes(user.username)) continue
    await ctx.receive(approvalTrigger(mr, user)); round.received += 1
  }
  ctx.state.set(KV.gitlab.approvals(number), users.map(user => user.username))
}

/** A changed merge-request pipeline fingerprint becomes one Trigger; the first observation only sets the baseline. */
async function pollPipeline(ctx: SourceContext, commands: SourceContext['commands'], number: number,
  mr: Awaited<ReturnType<typeof readMergeRequest>>, change: Awaited<ReturnType<typeof snapshotOf>>, round: GitlabRound): Promise<void> {
  if (!change.pipeline?.id) return
  const jobs = await readJobs(commands, change.pipeline.id)
  const snapshot = { status: change.pipeline.status, jobs: jobs.map(job => ({ name: job.name, status: job.status, allowFailure: !!job.allow_failure })) }
  const fingerprint = JSON.stringify({ status: snapshot.status, failed: ciFailures(snapshot), running: ciCounts(snapshot).running })
  const previous = ctx.state.get(KV.gitlab.ci(number))
  const revision = previous ? previous.revision + 1 : 0
  if (previous && previous.fingerprint !== fingerprint) {
    await ctx.receive(mergeRequestPipelineTrigger(mr, revision, ciSummary(snapshot, `MR !${number}`, `gitlab/merge_requests/${number}/pipelines`)))
    round.received += 1
  }
  ctx.state.set(KV.gitlab.ci(number), { fingerprint, revision })
}

/** Default-branch pipeline transitions; only a change after the first observation becomes a Trigger. */
async function pollBranchPipeline(ctx: SourceContext, commands: SourceContext['commands'], round: GitlabRound): Promise<void> {
  const config = ctx.config<GitlabConfig>(SOURCE)
  if (!config?.observeCi) return
  const branch = await readDefaultBranch(commands)
  const result = await readBranchPipeline(commands, branch)
  if (!result) return
  const previous = ctx.state.get(KV.gitlab.branchCi)
  const failures = ciFailures(result.snapshot)
  const revision = previous?.branch === branch ? previous.revision : 0
  if (previous?.branch === branch && JSON.stringify(failures) !== JSON.stringify(previous.failures ?? [])) {
    const summary = ciSummary(result.snapshot, `default branch ${branch}`, `gitlab/commits/${result.pipeline.sha ?? ''}/pipelines`)
    await ctx.receive(branchPipelineTrigger(branch, result.pipeline.sha ?? '', revision + 1, summary, result.pipeline.web_url ?? ''))
    round.received += 1
    ctx.state.set(KV.gitlab.branchCi, { branch, failures, revision: revision + 1 })
  } else {
    ctx.state.set(KV.gitlab.branchCi, { branch, failures, revision })
  }
}

/** Reads notes and discussions for one item from its Thread cursor and advances the cursor after intake. */
async function intakeNotes(ctx: SourceContext, commands: SourceContext['commands'], kind: ItemKind, iid: number, url: string | undefined,
  round: GitlabRound, lookback: number): Promise<void> {
  const agent = ctx.deployment.forge.login
  const threadKey = `${SOURCE}:${itemThread(kind, iid)}`
  const since = ctx.state.get(KV.gitlab.cursor(threadKey)) ?? cursorAt(round.started, lookback)
  for (const note of await readNotes(commands, kind, iid, since)) {
    const trigger = noteTrigger(note, { kind, iid, ...url ? { url } : {} }, agent)
    if (trigger) { await ctx.receive(trigger); round.received += 1 }
  }
  if (kind === 'mr') {
    for (const item of await readDiscussions(commands, kind, iid)) {
      const trigger = noteTrigger(item.note, { kind, iid, ...url ? { url } : {} }, agent, item.discussionId)
      if (trigger) { await ctx.receive(trigger); round.received += 1 }
    }
  }
  ctx.state.set(KV.gitlab.cursor(threadKey), cursorAt(round.started, lookback))
}

/** Counts failures, ignores a rate limit as a transient, and reports after the configured threshold. */
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  await ctx.ready
  if (signal.aborted) return
  if (!ctx.configured()) { ctx.report(SOURCE, health('paused', 'setupPending')); return }
  let failures = 0
  while (!signal.aborted) {
    const config = ctx.config<GitlabConfig>(SOURCE)
    if (!config) ctx.report(SOURCE, health('paused', 'sourceOff'))
    else {
      const at = new Date().toISOString()
      try {
        const round = await pollRound(ctx, signal)
        failures = 0
        ctx.report(SOURCE, { state: 'ready', detail: `${round.received} received; next poll ≥ ${config.pollSeconds}s`, at })
      } catch (error) {
        failures += 1
        // A 429 is a transient rate limit, not a broken Thread; it never quarantines or reddens the Source by itself.
        if (error instanceof CliError && error.code === 429) failures = 0
        else if (!signal.aborted && failures >= config.failuresBeforeError) {
          ctx.report(SOURCE, health('error', 'pollFailures', { count: String(failures), error: String(error) }))
        }
      }
    }
    await pause((config?.pollSeconds ?? 60) * 1000, signal)
  }
}
