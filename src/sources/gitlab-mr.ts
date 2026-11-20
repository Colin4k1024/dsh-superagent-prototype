/** GitLab merge-request binding, lifecycle observation and terminal notices for the source-neutral ForgePort. */
import { key, liveTicket, type OutboundMessage, type Ticket } from '../core/index.ts'
import type { Deployment } from '../deployment.ts'
import type { ChangeRef, ChangeSnapshot } from './forge.ts'
import type { SourceContext } from './host.ts'
import { changeRef, gitlabPage, itemThread, SOURCE, type GitlabMergeRequest } from './gitlab-trigger.ts'
import { readApprovals, readChanges, readMergeRequest } from './gitlab-read.ts'

/** Projects one GitLab MR onto the source-neutral change snapshot. */
export function snapshotOf(mr: GitlabMergeRequest, deployment: Pick<Deployment, 'gitlab'>): ChangeSnapshot {
  const project = deployment.gitlab?.projectId
  const state = mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : mr.state === 'locked' ? 'locked' : 'open'
  return { ref: { kind: 'change', number: mr.iid }, state, url: mr.web_url, authorId: mr.author.username,
    ...(mr.detailed_merge_status || mr.merge_status ? { mergeable: mr.detailed_merge_status === 'mergeable' || mr.merge_status === 'can_be_merged' } : {}),
    ...(mr.sha ? { headSha: mr.sha } : {}), ...(mr.source_branch ? { headBranch: mr.source_branch } : {}),
    ...(mr.target_branch ? { baseBranch: mr.target_branch } : {}),
    sameProject: mr.source_project_id != null && mr.target_project_id != null && mr.source_project_id === mr.target_project_id
      && mr.target_project_id === project,
    ...(mr.draft != null ? { draft: mr.draft } : {}), ...(mr.merged_at ? { mergedAt: mr.merged_at } : {}),
    ...(mr.closed_at ? { closedAt: mr.closed_at } : {}),
    ...(mr.merge_when_pipeline_succeeds != null ? { autoMerge: mr.merge_when_pipeline_succeeds } : {}),
    ...(mr.head_pipeline ? { pipeline: { status: mr.head_pipeline.status, ...mr.head_pipeline.id ? { id: mr.head_pipeline.id } : {},
      ...mr.head_pipeline.web_url ? { url: mr.head_pipeline.web_url } : {} } } : {}) }
}

/** Reads one MR. */
export async function readChange(ctx: SourceContext, ref: ChangeRef, signal?: AbortSignal): Promise<ChangeSnapshot> {
  const commands = ctx.commands.withSignal(signal)
  const snapshot = snapshotOf(await readMergeRequest(commands, ref.number), ctx.deployment)
  const approvals = await readApprovals(commands, ref.number).catch(() => undefined)
  const changes = await readChanges(commands, ref.number).catch(() => undefined)
  return { ...snapshot, ...approvals ? { approvals: { approvedBy: (approvals.approved_by ?? []).map(item => item.user.username),
    ...approvals.approvals_required != null ? { required: approvals.approvals_required } : {} } } : {}, ...changes ? { changes } : {} }
}

/** The merge-request numbers a ticket follows, optionally only the open ones. */
export const numbersOf = (ticket: Pick<Ticket, 'follows'>, openOnly = false): number[] =>
  (ticket.follows ?? []).filter(follow => !openOnly || !follow.closed).flatMap(follow => changeRef(follow.thread)?.number ?? [])

/**
 * Binds an open MR to a ticket when it is the ticket's origin MR or an agent-authored MR in the project from the
 * ticket's branch. One MR binds to at most one open ticket.
 */
export function claimChange(ctx: SourceContext, ticketId: string, change: ChangeSnapshot): string | undefined {
  const ticket = ctx.tickets.get(ticketId)
  if (!ticket || !liveTicket(ticket)) return 'Ticket ended (MR was closed or work finished); do not resume it'
  const origin = ctx.triggers.get(ticket.origin.triggerId)
  const started = origin?.source === SOURCE && origin.meta.item === 'mr' && origin.meta.iid === change.ref.number
  const agent = ctx.deployment.forge.login
  const opened = change.authorId === agent && change.sameProject && !!ticket.execution?.name
    && change.headBranch?.split('/').at(-1) === ticket.execution.name
  if (!started && !opened) return `MR does not belong to this ticket: use the source MR or an MR by ${agent} from a branch whose last path segment is DSH_SUPERAGENT_NAME; omit change_number when no MR exists`
  const owner = ctx.tickets.open().find(item => numbersOf(item, true).includes(change.ref.number))
  if (owner && owner.id !== ticketId) return 'MR already belongs to another active ticket'
  const follow = ticket.follows?.find(item => item.thread === `${SOURCE}:${itemThread('mr', change.ref.number)}`)
  if (change.state === 'open' && (!follow || follow.closed || (opened && !follow.own))) {
    ctx.atomic(() => {
      ctx.tickets.bindThread(ticketId, { source: SOURCE, id: itemThread('mr', change.ref.number) }, opened)
      ctx.threads.patch(`${SOURCE}:${itemThread('mr', change.ref.number)}`, { number: change.ref.number, isMr: true, url: change.url,
        ...change.headBranch ? { sourceBranch: change.headBranch } : {}, ...change.baseBranch ? { targetBranch: change.baseBranch } : {} })
    })
  }
  return undefined
}

/** Reconciles a polled MR with its tickets: only a merge or close ends them, and each close is reported once. */
export async function observeChange(ctx: SourceContext, change: ChangeSnapshot): Promise<boolean> {
  const ended = change.state === 'merged' || change.state === 'closed'
  if (ended) {
    const at = change.mergedAt ?? change.closedAt ?? new Date().toISOString()
    if (ctx.tickets.open().some(ticket => numbersOf(ticket, true).includes(change.ref.number))) {
      ctx.tickets.threadClosed({ source: SOURCE, id: itemThread('mr', change.ref.number) }, change.state === 'merged' ? 'merged' : 'closed', at)
    }
  }
  ctx.threads.patch(`${SOURCE}:${itemThread('mr', change.ref.number)}`, { state: change.state, ...change.pipeline ? { pipeline: change.pipeline.status } : {} })
  return ended
}

/** Host-side merge through the separate Maintainer CLI; the worker token never has this permission. */
export async function mergeChange(ctx: SourceContext, change: ChangeSnapshot, options: { sha?: string } = {}): Promise<void> {
  const mergeCli = ctx.deployment.gitlab?.mergeCli
  if (!mergeCli) throw new Error('The host merge CLI is not configured; a person must merge this MR')
  const project = ctx.deployment.gitlab?.projectId
  if (!project) throw new Error('The GitLab project id is not resolved')
  const args = ['api', `projects/${project}/merge_requests/${change.ref.number}/merge`, '--method', 'PUT']
  if (options.sha) args.push('-f', `sha=${options.sha}`)
  await ctx.commands.run(mergeCli, args)
}

/** One terminal notice to a ticket's non-GitLab channels when its MR merged or closed. */
export function terminalNotices(ctx: SourceContext, ticket: Ticket, request: string): OutboundMessage[] {
  const outcome = ticket.ended?.outcome
  if (outcome !== 'merged' && outcome !== 'closed') return []
  const follows = (ticket.follows ?? []).filter(follow => follow.closed && changeRef(follow.thread) !== undefined)
  const last = follows.sort((a, b) => b.closed!.at.localeCompare(a.closed!.at))[0]
  if (!last) return []
  const number = changeRef(last.thread)!.number
  const host = ctx.deployment.forge.host ?? 'https://gitlab.com'
  const url = gitlabPage(host, ctx.deployment.forge.repository, 'mr', number)
  const chinese = /\p{Script=Han}/u.test(request) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(request)
  const text = chinese
    ? outcome === 'merged' ? `[MR !${number}](${url}) 已合并。` : `[MR !${number}](${url}) 已关闭，未合并。`
    : outcome === 'merged' ? `[MR !${number}](${url}) has merged.` : `[MR !${number}](${url}) was closed without merging.`
  return ticket.channels.filter(channel => channel.source !== SOURCE).map(channel => ({
    id: key('mr-terminal', String(number), channel.source, JSON.stringify(channel.address), outcome), channel, text, kind: 'notice', ticketId: ticket.id }))
}
