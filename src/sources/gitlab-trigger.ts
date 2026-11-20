/** Normalizes GitLab issues, merge requests, notes/discussions, approvals and pipelines into domain Triggers. */
import { z } from 'zod'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'
import type { ChangeRef } from './forge.ts'
import { escapeRegExp } from '../infra/text.ts'

export const SOURCE = 'gitlab'
export type ItemKind = 'issue' | 'mr'
/** Parses a `gitlab:mr:<iid>` Thread; an issue Thread is not a change. */
export const changeRef = (thread: string): ChangeRef | undefined => {
  if (!thread.startsWith(`${SOURCE}:mr:`)) return undefined
  const iid = Number(thread.slice(`${SOURCE}:mr:`.length))
  return Number.isSafeInteger(iid) && iid > 0 ? { kind: 'change', number: iid } : undefined
}
/** The Thread id of one GitLab issue or merge request; the kind keeps the two iid sequences apart. */
export const itemThread = (kind: ItemKind, iid: number): string => `${kind}:${iid}`
/** The GitLab web page of an issue or merge request. */
export const gitlabPage = (host: string, project: string, kind: ItemKind, iid: number): string =>
  `${host.replace(/\/+$/, '')}/${project}/-/${kind === 'mr' ? 'merge_requests' : 'issues'}/${iid}`
/** Reply address: the Issue/MR conversation, or a discussion thread when `discussionId` is set. */
export const gitlabChannel = (kind: ItemKind, iid: number, extra: { noteId?: number; discussionId?: string; url?: string } = {}): ChannelRef => ({
  source: SOURCE, thread: `${SOURCE}:${itemThread(kind, iid)}`,
  address: { kind, iid: String(iid), ...extra.noteId ? { noteId: String(extra.noteId) } : {},
    ...extra.discussionId ? { discussionId: extra.discussionId } : {}, ...extra.url ? { url: extra.url } : {} },
})

/** A GitLab user as notes, issues and MRs return it; project/group access tokens create bot users. */
export const GitlabUserSchema = z.looseObject({ id: z.number().int().positive(), username: z.string().min(1),
  name: z.string().optional(), bot: z.boolean().optional(), state: z.string().optional() })
export type GitlabUser = z.infer<typeof GitlabUserSchema>
/** A note (comment) on an Issue or MR; a DiffNote carries its file and line. */
export const GitlabNoteSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), author: GitlabUserSchema,
  created_at: z.string().nullish(), updated_at: z.string().nullish(), system: z.boolean().optional(),
  noteable_type: z.string().optional(), noteable_iid: z.number().nullish(), type: z.string().nullish(),
  position: z.looseObject({ new_path: z.string().nullish(), old_path: z.string().nullish(), new_line: z.number().nullish(),
    old_line: z.number().nullish() }).nullish(),
  resolvable: z.boolean().optional(), resolved: z.boolean().optional(),
})
export type GitlabNote = z.infer<typeof GitlabNoteSchema>
/** The fields an Issue and an MR share. */
const GitlabItemFields = {
  id: z.number(), iid: z.number().int().positive(), title: z.string(), description: z.string().nullish(),
  state: z.string(), created_at: z.string(), updated_at: z.string().optional(), web_url: z.string(), author: GitlabUserSchema,
  labels: z.array(z.union([z.string(), z.looseObject({ title: z.string() })])).nullish(),
}
export const GitlabIssueSchema = z.looseObject(GitlabItemFields)
export type GitlabIssue = z.infer<typeof GitlabIssueSchema>
export const GitlabMergeRequestSchema = z.looseObject({ ...GitlabItemFields,
  source_branch: z.string().optional(), target_branch: z.string().optional(), sha: z.string().optional(),
  source_project_id: z.number().optional(), target_project_id: z.number().optional(),
  draft: z.boolean().optional(), merged_at: z.string().nullish(), closed_at: z.string().nullish(),
  merge_when_pipeline_succeeds: z.boolean().optional(), detailed_merge_status: z.string().optional(), merge_status: z.string().optional(),
  head_pipeline: z.looseObject({ id: z.number().optional(), status: z.string(), sha: z.string().optional(), web_url: z.string().optional() }).nullish(),
})
export type GitlabMergeRequest = z.infer<typeof GitlabMergeRequestSchema>
export const GitlabApprovalSchema = z.looseObject({ approved_by: z.array(z.looseObject({ user: GitlabUserSchema })).default([]),
  approvals_required: z.number().int().optional(), approvals_left: z.number().int().optional() })
export type GitlabApproval = z.infer<typeof GitlabApprovalSchema>
export const GitlabPipelineSchema = z.looseObject({ id: z.number(), status: z.string(), sha: z.string().optional(), ref: z.string().optional(), web_url: z.string().optional() })
export type GitlabPipeline = z.infer<typeof GitlabPipelineSchema>
export const GitlabJobSchema = z.looseObject({ id: z.number(), name: z.string(), status: z.string(), allow_failure: z.boolean().optional(), web_url: z.string().optional() })
export type GitlabJob = z.infer<typeof GitlabJobSchema>

/** True when GitLab reports a person rather than a bot or a blocked account. */
export const isHumanUser = (user: Pick<GitlabUser, 'bot' | 'state'>): boolean => user.bot !== true && user.state !== 'blocked'
/** True when `text` mentions `username`, whose GitLab spelling may contain dots, underscores and hyphens. */
export const mentions = (text: string, username: string): boolean =>
  new RegExp(`(?:^|[^A-Za-z0-9_.-])@${escapeRegExp(username)}(?![A-Za-z0-9_.-])`, 'i').test(text)
/** Label titles, whether GitLab returned strings or label objects. */
export const labelsOf = (item: Pick<GitlabIssue | GitlabMergeRequest, 'labels'>): string[] =>
  (item.labels ?? []).map(label => typeof label === 'string' ? label : label.title)

/** The address of a GitLab Issue, MR or note URL on the configured instance and project. */
export function gitlabAddress(url: string, host: string, project: string): { kind: ItemKind; iid: number; noteId?: number } | undefined {
  const base = host.replace(/\/+$/, '')
  const pattern = new RegExp(`^${escapeRegExp(base)}/${escapeRegExp(project)}/-/(issues|merge_requests)/(\\d+)(?:#note_(\\d+))?`)
  const match = pattern.exec(url)
  if (!match) return undefined
  return { kind: match[1] === 'merge_requests' ? 'mr' : 'issue', iid: Number(match[2]), ...match[3] ? { noteId: Number(match[3]) } : {} }
}

/** The model-visible text of a note, with a DiffNote's file:line before it. */
export function noteText(note: GitlabNote): string {
  if (note.type !== 'DiffNote' || !note.position) return note.body ?? ''
  const line = note.position.new_line ?? note.position.old_line
  const place = `${note.position.new_path ?? note.position.old_path ?? ''}${line != null ? `:${line}` : ''}`
  return [place, note.body ?? ''].filter(Boolean).join('\n\n')
}

const author = (user: GitlabUser, agent: string) => ({ actor: { source: SOURCE, id: user.username },
  human: isHumanUser(user) && user.username !== agent })

/** A newly opened Issue's title and body. */
export function issueTrigger(issue: GitlabIssue, agent: string): Trigger {
  const body = issue.description ?? ''
  const at = issue.created_at
  return { id: key('gitlab-item', 'issue', String(issue.iid)), source: SOURCE,
    threads: [{ source: SOURCE, id: itemThread('issue', issue.iid) }], ...author(issue.author, agent), at,
    text: `${issue.title}\n\n${body}`, ...(mentions(body, agent) ? { addressed: 'mention' as const } : {}),
    channel: gitlabChannel('issue', issue.iid, { url: issue.web_url }), url: issue.web_url,
    meta: { item: 'issue', iid: issue.iid, event: 'body', labels: labelsOf(issue) } }
}

/** A newly opened merge request's title and description. */
export function mergeRequestTrigger(mr: GitlabMergeRequest, agent: string): Trigger {
  const body = mr.description ?? ''
  return { ...issueTrigger({ ...mr, iid: mr.iid }, agent), id: key('gitlab-item', 'mr', String(mr.iid)),
    threads: [{ source: SOURCE, id: itemThread('mr', mr.iid) }],
    channel: gitlabChannel('mr', mr.iid, { url: mr.web_url }),
    meta: { item: 'mr', iid: mr.iid, event: 'body', labels: labelsOf(mr), ...mr.source_branch ? { sourceBranch: mr.source_branch } : {},
      ...mr.target_branch ? { targetBranch: mr.target_branch } : {}, ...mr.draft != null ? { draft: mr.draft } : {} } }
}

/** A human note on an Issue or MR; system notes are not human messages and produce none. */
export function noteTrigger(note: GitlabNote, ref: { kind: ItemKind; iid: number; url?: string }, agent: string,
  discussionId?: string): Trigger | undefined {
  if (note.system) return undefined
  const at = note.updated_at ?? note.created_at ?? new Date().toISOString()
  const text = noteText(note)
  return { id: key('gitlab-note', ref.kind, String(ref.iid), String(note.id), at), source: SOURCE,
    threads: [{ source: SOURCE, id: itemThread(ref.kind, ref.iid) }], ...author(note.author, agent), at, text,
    ...(mentions(note.body ?? '', agent) ? { addressed: 'mention' as const } : {}),
    channel: gitlabChannel(ref.kind, ref.iid, { noteId: note.id, ...discussionId ? { discussionId } : {}, ...ref.url ? { url: ref.url } : {} }),
    ...(ref.url ? { url: ref.url } : {}),
    meta: { item: ref.kind, iid: ref.iid, event: 'note', noteId: note.id, ...discussionId ? { discussionId } : {},
      ...note.type ? { noteType: note.type } : {}, ...note.position?.new_path ? { path: note.position.new_path } : {},
      ...note.position?.new_line != null ? { line: note.position.new_line } : {} } }
}

/** An approval, which has no body but can wake a worker waiting for review. */
export function approvalTrigger(mr: GitlabMergeRequest, approver: GitlabUser, at = new Date().toISOString()): Trigger {
  return { id: key('gitlab-approval', String(mr.iid), approver.username, at), source: SOURCE,
    threads: [{ source: SOURCE, id: itemThread('mr', mr.iid) }], actor: { source: SOURCE, id: approver.username },
    human: isHumanUser(approver), at, text: `${approver.username} approved merge request !${mr.iid}`,
    channel: gitlabChannel('mr', mr.iid, { url: mr.web_url }), url: mr.web_url,
    meta: { item: 'mr', iid: mr.iid, event: 'approval', approver: approver.username } }
}

/** A merge request pipeline transition; only a changed status set becomes a Trigger. */
export function mergeRequestPipelineTrigger(mr: GitlabMergeRequest, revision: number, summary: string): Trigger {
  return { id: key('gitlab-ci', String(mr.iid), String(revision)), source: SOURCE,
    threads: [{ source: SOURCE, id: itemThread('mr', mr.iid) }], actor: { source: SOURCE, id: '' }, human: false,
    at: new Date().toISOString(), text: summary, channel: gitlabChannel('mr', mr.iid, { url: mr.web_url }), url: mr.web_url,
    meta: { item: 'mr', iid: mr.iid, event: 'ci', ci: true, revision } }
}

/** A default-branch pipeline transition; it has no person to reply to, so it has no channel. */
export function branchPipelineTrigger(branch: string, sha: string, revision: number, summary: string, url: string): Trigger {
  return { id: key('gitlab-ci', `branch:${branch}`, String(revision)), source: SOURCE,
    threads: [{ source: SOURCE, id: `ci:${branch}` }], actor: { source: SOURCE, id: '' }, human: false,
    at: new Date().toISOString(), text: summary, url, meta: { item: 'branch', branch, sha, event: 'ci', ci: true, revision } }
}
