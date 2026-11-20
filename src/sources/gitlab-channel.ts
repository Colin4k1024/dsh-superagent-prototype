/** GitLab outbound channel: posts Issue/MR notes and discussion replies, idempotently under the agent account. */
import { z } from 'zod'
import type { OutboundMessage } from '../core/index.ts'
import { CliError } from '../infra/commands.ts'
import type { SourceContext } from './host.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'
import { gitlabPage, GitlabNoteSchema, SOURCE, type ItemKind, type GitlabNote } from './gitlab-trigger.ts'

const DiscussionSchema = z.looseObject({ id: z.string(), notes: z.array(GitlabNoteSchema) })
/** GitLab quick actions are line-leading `/commands`; a zero-width space keeps a message from executing one. */
export const escapeQuickActions = (text: string): string => text.replace(/^(\s*)\//gm, '$1\u200b/')
/** True when the target can never receive a reply: a deleted note/Issue/MR, a locked discussion, or a system note. */
const gone = (error: unknown): boolean => error instanceof CliError
  && (error.code === 404 || (error.code === 403 && /locked/i.test(error.message)))
const collection = (kind: ItemKind): 'merge_requests' | 'issues' => kind === 'mr' ? 'merge_requests' : 'issues'
/**
 * Posts one message once. A hidden marker makes a retry idempotent; a discussion reply falls back to the MR/Issue
 * conversation when the discussion or its note can no longer be replied to.
 */
export async function sendGitlab(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const { commands } = host
  const { kind, iid, discussionId } = message.channel.address
  const number = Number(iid)
  if (!number || (kind !== 'issue' && kind !== 'mr')) throw new Error('Missing GitLab reply target')
  const project = collection(kind)
  const marker = `<!-- dsh-superagent:${message.id} -->`
  const body = `${escapeQuickActions(message.text)}\n\n${marker}`
  const agent = commands.deployment.forge.login
  try {
    if (await alreadyThere(commands, project, number, discussionId, marker, agent)) return 'sent'
    await post(commands, project, number, discussionId, body)
    return 'sent'
  } catch (error) {
    // A system note cannot be replied to; deliver in the MR/Issue conversation instead.
    if (discussionId && error instanceof CliError && error.code === 400) {
      try { await post(commands, project, number, undefined, body); return 'sent' }
      catch (fallback) { if (gone(fallback)) return 'gone'; throw fallback }
    }
    if (gone(error)) return 'gone'
    throw error
  }
}

async function post(commands: SourceContext['commands'], project: string, number: number, discussionId: string | undefined, body: string): Promise<void> {
  const path = discussionId ? `${project}/${number}/discussions/${encodeURIComponent(discussionId)}/notes` : `${project}/${number}/notes`
  await commands.gitlab(z.unknown(), path, '--method', 'POST', '-f', `body=${body}`)
}

/** True when the agent already posted this exact message under the target discussion or conversation. */
async function alreadyThere(commands: SourceContext['commands'], project: string, number: number, discussionId: string | undefined,
  marker: string, agent: string): Promise<boolean> {
  const mine = (note: GitlabNote): boolean => note.author.username === agent && (note.body ?? '').includes(marker)
  if (discussionId) {
    const discussions = await commands.gitlabPages(DiscussionSchema, `${project}/${number}/discussions?per_page=100`)
    return discussions.some(item => item.id === discussionId && item.notes.some(mine))
  }
  const notes = await commands.gitlabPages(GitlabNoteSchema, `${project}/${number}/notes?sort=desc&per_page=100`)
  return notes.some(mine)
}

/** The panel link for a GitLab address; `url` wins when the Source recorded one. */
export function gitlabLink(address: Record<string, string>, links: ChannelLinks): ChannelLink {
  const kind = address.kind === 'issue' ? 'issue' : 'mr'
  const iid = Number(address.iid)
  const url = address.url ?? (links.forge?.host && links.repository && iid ? gitlabPage(links.forge.host, links.repository, kind, iid) : '')
  return { url, label: address.discussionId ? { zh: `GitLab !${iid} 的 review 讨论`, en: `Review discussion on GitLab !${iid}` }
    : { zh: `GitLab !${iid}`, en: `GitLab !${iid}` } }
}

/** The Source id this Channel writes through; kept here so the module names its own origin. */
export const CHANNEL_SOURCE = SOURCE
