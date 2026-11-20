/** Executor Session tools for reading ticket context, acknowledging requests, managing threads, handing back out-of-scope triggers, and reporting status. */
import { z } from 'zod'
import { liveTicket, type EngineForExecutor, type Ticket } from '../../core/index.ts'
import { IM_WORDS } from '../../infra/text.ts'
import type { ForgeTarget } from '../../sources/forge.ts'
import type { SourceRegistry } from '../../sources/registry.ts'
import { readResource, type ResourceHost } from '../resources.ts'
import { ticketChange } from '../cards.ts'
import type { Store } from '../store.ts'
import { reportRelay, threadFollowedNotice } from '../notices.ts'
import { mergeGate } from '../merge-gate.ts'
import { KV } from '../../kv.ts'
import type { Sessions } from '../sessions.ts'
import { AcknowledgementSchema, readTool, tool, type Tool } from './tool.ts'

export interface ExecutorToolsHost {
  readonly engine: Pick<EngineForExecutor, 'report' | 'reply' | 'markUnrelated' | 'handback' | 'followForContext'>
  readonly store: Pick<Store, 'tickets' | 'replyStatus' | 'atomic' | 'set'>
  readonly sessions: Pick<Sessions, 'relay' | 'notify'>
  readonly resources: ResourceHost
  /** The deployment's Sources, for projecting a ticket's change into its card and notices. */
  readonly sources: Pick<SourceRegistry, 'forges'>
  /** Resolves a ticket's code host and the context its Forge methods need; undefined for a ticket with no code host. */
  readonly changes: { for(ticket: Ticket): ForgeTarget | undefined }
  sendReplies(): Promise<void>
}

export function executorTools(host: ExecutorToolsHost, ticket: Ticket): Tool[] {
  const ticketId = ticket.id
  return [
    readTool('Read one page of a resource of this ticket that the resource parameter lists. Follow next_offset, and next_resource where a page names one.',
      true, (resource, offset, limit, signal) => readResource(host.resources, resource, offset, limit, ticketId, signal)),
    tool({
      name: 'orchestrator_ack',
      description: 'Acknowledge one original human request before substantial work, as the replies section says; it posts as a reply to that message.',
      schema: z.object({
        trigger_id: z.string(),
        text: AcknowledgementSchema.describe(`At most ${IM_WORDS} words; Markdown is supported.`),
      }).strict(),
      execute: async args => {
        const reply = host.engine.reply({ purpose: 'acknowledgement', ticketId, triggerId: args.trigger_id, text: args.text })
        if (reply.status !== 'sent') await host.sendReplies()
        return { trigger_id: args.trigger_id, acknowledgement: host.store.replyStatus(reply.id)!, reused: reply.reused }
      },
    }),
    tool({
      name: 'orchestrator_thread_unrelated',
      description: 'Stop following an attached thread that is not about this ticket, as the work section says; its own threads cannot be dropped.',
      schema: z.object({
        thread: z.string().min(1).describe('The thread key, which trigger/<id> of one of its messages shows as thread, such as feishu:<chat>:<root> or github:<number>.'),
        reason: z.string().trim().min(1).max(300).describe('One sentence on why the thread is not about this ticket.'),
      }).strict(),
      execute: async args => { host.engine.markUnrelated(ticketId, args.thread, args.reason); return { removed: true, thread: args.thread } },
    }),
    tool({
      name: 'orchestrator_thread_follow',
      description: 'Follow a related thread, such as an Issue or another PR, for context only.',
      schema: z.object({
        thread: z.string().describe('Thread key, such as github:<number>.'),
        reason: z.string().trim().min(1).max(300).describe('How it relates, in one sentence.'),
      }).strict(),
      execute: async args => host.store.atomic(() => {
        const at = args.thread.indexOf(':')
        if (at < 1 || at === args.thread.length - 1) throw new Error('A thread key is <source>:<id>, such as github:<number>')
        const followed = host.engine.followForContext(ticketId, { source: args.thread.slice(0, at), id: args.thread.slice(at + 1) })
        if (followed) host.sessions.notify(...threadFollowedNotice(ticketId, args.thread, args.reason))
        return { followed, thread: args.thread }
      }),
    }),
    tool({
      name: 'orchestrator_trigger_handback',
      description: 'Hand back a message that asks for work beyond this ticket or for another one, for a fresh assessment; once per message. queued is false while another ticket still decides it, and for a message that was never this ticket\'s to decide, such as a bot\'s, which is assessed without it.',
      schema: z.object({
        trigger_id: z.string().min(1),
        reason: z.string().trim().min(1).max(300).describe('One sentence on what it asks for beyond this ticket.'),
      }).strict(),
      execute: async args => ({ trigger_id: args.trigger_id, queued: host.engine.handback(ticketId, args.trigger_id, args.reason) }),
    }),
    tool({
      name: 'orchestrator_report',
      description: 'Report progress, ready, blocked, failed or dropped, as the work and handoff sections say.',
      schema: z.object({
        state: z.enum(['progress', 'ready', 'blocked', 'failed', 'dropped']),
        summary: z.string().min(1),
        human_action: z.string().trim().min(1).max(1000).nullish().describe('One concrete question for a person, also with state=progress; omit to keep the pending one, null to clear it.'),
        question_for_trigger_id: z.string().optional().describe('With human_action: the human message that raised the question, which is asked where that person wrote.'),
        change_number: z.number().int().positive().nullish()
          .describe('The ticket\'s change (PR/MR): its source change, or one the agent opened from a branch named after this ticket (DSH_SUPERAGENT_NAME). Omit when there is no change.'),
        pr_number: z.number().int().positive().nullish().describe('Deprecated alias of change_number; accepted for sessions started before the rename.'),
        reply_to_trigger_id: z.string().optional().describe('The explicit human question this report answers; never for ordinary progress.'),
      }).strict(),
      execute: async (args, signal) => {
        const current = host.store.tickets.get(ticketId)
        if (!current || !liveTicket(current)) throw new Error('Ticket ended (PR was closed or work finished); do not resume it')
        const requested = args.change_number ?? args.pr_number
        const target = requested == null ? undefined : host.changes.for(current)
        if (requested != null && !target) throw new Error('This ticket has no code host; omit change_number')
        const change = target && requested != null
          ? await target.forge.change.read(target.context, { kind: 'change', number: requested }, signal) : undefined
        // Claim the change, record the report, and queue the relay atomically so a rejected claim or invalid report leaves no partial state, and a recorded report always reaches the main Session.
        return host.store.atomic(() => {
          const refused = change && target ? target.forge.change.claim(target.context, ticketId, change) : undefined
          if (refused) throw new Error(refused)
          const report = { state: args.state, summary: args.summary, ...(args.human_action !== undefined ? { question: args.human_action } : {}),
            ...(args.question_for_trigger_id ? { askedBy: args.question_for_trigger_id } : {}),
            ...(args.reply_to_trigger_id ? { answers: args.reply_to_trigger_id } : {}) }
          const updated = host.engine.report(ticketId, report)
          const relay = reportRelay(updated, report, ticketChange(updated, host.sources))
          if (relay) host.sessions.relay(relay.id, relay.text)
          const notification = relay ? 'orchestrator' : 'internal_only'
          return { reported: true, notification, ...(updated.attention ? { attention: updated.attention } : {}) }
        })
      },
    }),
    tool({
      name: 'orchestrator_merge_request',
      description: 'Merge this ticket\'s MR through the host gate: it must be open, non-draft, mergeable, with a successful pipeline and an approval by someone other than its author. Use after the reviews the delivery requirements name.',
      schema: z.object({
        change_number: z.number().int().positive().optional().describe('The MR to merge; defaults to the open MR this ticket follows.'),
        head_sha: z.string().min(1).optional().describe('The head SHA the reviewer approved; the gate refuses when the MR head differs.'),
        evidence: z.string().trim().min(1).max(1000).describe('Why this MR is ready: the approvals and pipeline result you read.'),
      }).strict(),
      execute: async (args, signal) => {
        const current = host.store.tickets.get(ticketId)
        if (!current || !liveTicket(current)) throw new Error('Ticket ended (MR was closed or work finished); do not resume it')
        const target = host.changes.for(current)
        if (!target?.forge.change.merge) throw new Error('This ticket\'s Source has no host merge')
        const number = args.change_number ?? target.forge.change.numbersOf(current, true).at(-1)
        if (!number) throw new Error('No open merge request to merge; report ready with change_number first')
        const change = await target.forge.change.read(target.context, { kind: 'change', number }, signal)
        const gate = mergeGate(change, args.head_sha ? { sha: args.head_sha } : {})
        if (!gate.ok) throw new Error(gate.reason)
        await target.forge.change.merge(target.context, change, args.head_sha ? { sha: args.head_sha } : {})
        const at = new Date().toISOString()
        host.store.set(KV.gitlab.merge(number), { at, ticketId, approvedBy: change.approvals?.approvedBy ?? [],
          pipeline: change.pipeline?.status ?? '', sha: change.headSha ?? '', evidence: args.evidence })
        return { merged: true, change_number: number, sha: change.headSha, approved_by: change.approvals?.approvedBy ?? [],
          pipeline: change.pipeline?.status ?? '' }
      },
    }),
  ]
}
