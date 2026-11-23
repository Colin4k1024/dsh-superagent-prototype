/** Read-only GitLab project reads used by the Source's polling loops, the Executor tools and assessments. */
import { z } from 'zod'
import type { Commands } from '../infra/commands.ts'
import { GitlabApprovalSchema, GitlabIssueSchema, GitlabJobSchema, GitlabMergeRequestSchema, GitlabNoteSchema, GitlabPipelineSchema,
  type GitlabIssue, type GitlabMergeRequest, type GitlabNote, type ItemKind } from './gitlab-trigger.ts'
import { isHumanUser, noteText } from './gitlab-trigger.ts'
import type { ThreadContext } from './kind.ts'
import type { ChangeChecks, RepositoryRead } from './forge.ts'

/** The API collection of an Issue or MR. */
export const collection = (kind: ItemKind): 'issues' | 'merge_requests' => kind === 'mr' ? 'merge_requests' : 'issues'
/** A pending todo; `target.iid` names the Issue or MR to read once. */
export const GitlabTodoSchema = z.looseObject({ id: z.number(), target_type: z.string(), action_name: z.string().optional(),
  target: z.looseObject({ iid: z.number().int().positive().nullish(), project_id: z.number().optional() }).nullish() })
export type GitlabTodo = z.infer<typeof GitlabTodoSchema>

const updatedAfter = (since: string): string => `updated_after=${encodeURIComponent(since)}`
/** Issues updated since `since`, oldest first; the caller deduplicates by Trigger id. */
export const readIssues = (commands: Commands, since: string): Promise<GitlabIssue[]> =>
  commands.gitlabPages(GitlabIssueSchema, `issues?state=all&order_by=updated_at&sort=asc&${updatedAfter(since)}&per_page=100`)
/** Merge requests updated since `since`, oldest first. */
export const readMergeRequests = (commands: Commands, since: string): Promise<GitlabMergeRequest[]> =>
  commands.gitlabPages(GitlabMergeRequestSchema, `merge_requests?state=all&scope=all&order_by=updated_at&sort=asc&${updatedAfter(since)}&per_page=100`)
/** One merge request. */
export const readMergeRequest = (commands: Commands, iid: number): Promise<GitlabMergeRequest> =>
  commands.gitlab(GitlabMergeRequestSchema, `merge_requests/${iid}`)
/** One Issue. */
export const readIssue = (commands: Commands, iid: number): Promise<GitlabIssue> =>
  commands.gitlab(GitlabIssueSchema, `issues/${iid}`)
/** The approvals of one merge request. */
export const readApprovals = (commands: Commands, iid: number): Promise<z.infer<typeof GitlabApprovalSchema>> =>
  commands.gitlab(GitlabApprovalSchema, `merge_requests/${iid}/approvals`)

/**
 * Notes of one Issue/MR since `since`, oldest first. GitLab has no `since` filter on notes, so this reads the newest
 * page and filters locally; a caller with no cursor should pass the Thread's creation time to avoid replaying history.
 */
export async function readNotes(commands: Commands, kind: ItemKind, iid: number, since?: string): Promise<GitlabNote[]> {
  const notes = await commands.gitlabPages(GitlabNoteSchema, `${collection(kind)}/${iid}/notes?sort=desc&per_page=100`)
  const cutoff = since ? Date.parse(since) : Number.NEGATIVE_INFINITY
  return notes.filter(note => !note.system && Date.parse(note.updated_at ?? note.created_at ?? '') >= cutoff)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id - b.id)
}
/** Discussion notes of an MR, with the discussion id; a DiffNote is found here rather than in the note list. */
export async function readDiscussions(commands: Commands, kind: ItemKind, iid: number): Promise<{ discussionId: string; note: GitlabNote }[]> {
  const schema = z.looseObject({ id: z.string(), notes: z.array(GitlabNoteSchema) })
  const discussions = await commands.gitlabPages(schema, `${collection(kind)}/${iid}/discussions?per_page=100`)
  return discussions.flatMap(discussion => discussion.notes.filter(note => !note.system).map(note => ({ discussionId: discussion.id, note })))
}
/** Pending todos, used as a wake-up signal for Issues/MRs that may have new notes. */
export const readTodos = (commands: Commands): Promise<GitlabTodo[]> =>
  commands.gitlabRootPages(GitlabTodoSchema, 'todos?state=pending&per_page=100')

/** One project's default branch and path; the repository reader needs the ref. */
const ProjectSchema = z.looseObject({ id: z.number(), default_branch: z.string().optional(), path_with_namespace: z.string().optional() })
export const readProject = (commands: Commands): Promise<z.infer<typeof ProjectSchema>> => commands.gitlab(ProjectSchema, '')
/** The project's default branch, used for repository reads. */
export const readDefaultBranch = async (commands: Commands): Promise<string> => (await readProject(commands)).default_branch ?? 'main'

/** One pipeline. */
export const readPipeline = (commands: Commands, id: number): Promise<z.infer<typeof GitlabPipelineSchema>> =>
  commands.gitlab(GitlabPipelineSchema, `pipelines/${id}`)
/** The jobs of one pipeline, with their names, statuses and `allow_failure`. */
export const readJobs = (commands: Commands, id: number): Promise<z.infer<typeof GitlabJobSchema>[]> =>
  commands.gitlabPages(GitlabJobSchema, `pipelines/${id}/jobs?per_page=100`)
/** The newest pipeline of a ref, if any. Read one page directly (no `--paginate`, which would walk the whole history). */
export const readLatestPipeline = async (commands: Commands, ref: string): Promise<z.infer<typeof GitlabPipelineSchema> | undefined> =>
  (await commands.gitlab(z.array(GitlabPipelineSchema), `pipelines?ref=${encodeURIComponent(ref)}&order_by=id&sort=desc&per_page=1`))[0]

/** A CI snapshot: the overall status and each job; `allow_failure` jobs do not fail the snapshot. */
export interface CiSnapshot { status: string; jobs: { name: string; status: string; allowFailure: boolean }[] }
const FAILING = new Set(['failed', 'canceled'])
const RUNNING = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'manual', 'scheduled'])
export function ciCounts(snapshot: CiSnapshot): { failed: number; running: number } {
  return { failed: snapshot.jobs.filter(job => !job.allowFailure && FAILING.has(job.status)).length,
    running: snapshot.jobs.filter(job => RUNNING.has(job.status)).length }
}
export function ciFailures(snapshot: CiSnapshot): string[] {
  return snapshot.jobs.filter(job => !job.allowFailure && FAILING.has(job.status)).map(job => job.name).sort()
}
/** One model-facing line: what failed, what still runs, and where to read every job. */
export function ciSummary(snapshot: CiSnapshot, where: string, resource: string): string {
  const failed = ciFailures(snapshot)
  const running = snapshot.jobs.filter(job => RUNNING.has(job.status)).map(job => job.name)
  const names = (list: string[]) => list.slice(0, 5).join(', ') + (list.length > 5 ? `, and ${list.length - 5} more` : '')
  const line = failed.length ? `Pipeline ${snapshot.status}: failed ${failed.length}/${snapshot.jobs.length} ${where}: ${names(failed)}`
    : running.length ? `Pipeline ${snapshot.status}: running ${running.length}/${snapshot.jobs.length} ${where}: ${names(running)}`
    : `Pipeline ${snapshot.status}: all ${snapshot.jobs.length} jobs passed ${where}`
  return `${line}\nRead ${resource} for every job.`
}
/** The Thread fact for a pipeline: failed jobs are a problem, running jobs are neutral. */
export function ciFact(snapshot: CiSnapshot): { label?: string; value: string; problem?: true } {
  const counts = ciCounts(snapshot)
  return counts.failed ? { label: 'CI failed', value: String(counts.failed), problem: true }
    : counts.running ? { label: 'CI running', value: String(counts.running) } : { label: 'CI', value: snapshot.status }
}

/** The default branch's pipeline and jobs, with the pipeline id so a caller can poll it. */
export async function readBranchPipeline(commands: Commands, branch: string): Promise<{ pipeline: z.infer<typeof GitlabPipelineSchema>; snapshot: CiSnapshot } | undefined> {
  const pipeline = await readLatestPipeline(commands, branch)
  if (!pipeline) return undefined
  const jobs = await readJobs(commands, pipeline.id)
  return { pipeline, snapshot: { status: pipeline.status, jobs: jobs.map(job => ({ name: job.name, status: job.status, allowFailure: !!job.allow_failure })) } }
}

/** Reads a non-hidden repository file or directory at `ref`; hidden entries and node_modules are rejected. */
export async function readRepositoryPath(commands: Commands, path: string, kind: 'file' | 'directory'): Promise<string> {
  const parts = path.split('/').filter(part => part && part !== '.')
  if (parts.some(part => part === '..' || part.startsWith('.') || part === 'node_modules')) throw new Error('Only non-hidden repository source paths are available')
  const ref = await readDefaultBranch(commands)
  if (kind === 'file') return commands.gitlab(`repository/files/${parts.map(encodeURIComponent).join('%2F')}/raw?ref=${encodeURIComponent(ref)}`)
  const schema = z.array(z.looseObject({ name: z.string() }))
  const entries = await commands.gitlab(schema, `repository/tree?path=${encodeURIComponent(parts.join('/'))}&ref=${encodeURIComponent(ref)}&per_page=100`)
  return entries.map(entry => entry.name).filter(name => !name.startsWith('.') && name !== 'node_modules').sort().join('\n')
}


/** Bounded Thread context for assessments: the notes around a Trigger, by GitLab note id. */
export const gitlabThreadContext: ThreadContext<Record<string, unknown>> = {
  messageId: trigger => String(trigger.meta.noteId ?? ''),
  read: async (commands, trigger, part, cursor) => {
    const kind: ItemKind = trigger.meta.item === 'mr' ? 'mr' : 'issue'
    const iid = Number(trigger.meta.iid)
    if (!iid) throw new Error('This Trigger names no GitLab Issue or merge request')
    const notes = await readNotes(commands, kind, iid)
    const messages = notes.map(note => ({ id: String(note.id), from: note.author.username, at: note.created_at ?? '', text: noteText(note),
      ...!isHumanUser(note.author) ? { bot: true as const } : {}, ...note.position?.new_path ? { path: note.position.new_path } : {},
      ...note.position?.new_line != null ? { line: note.position.new_line } : {} }))
    if (part === 'root') return { messages: messages.slice(0, 1), body: { messages: messages.slice(0, 1) } }
    if (part === 'parent') {
      const at = messages.findIndex(message => message.id === String(trigger.meta.noteId ?? ''))
      const page = at > 0 ? [messages[at - 1]!] : []
      return { messages: page, body: { messages: page } }
    }
    const start = cursor ? messages.findIndex(message => message.id === cursor) + 1 : 0
    const page = messages.slice(Math.max(0, start), Math.max(0, start) + 20)
    return { messages: page, ...(Math.max(0, start) + 20 < messages.length && page.length ? { next: page.at(-1)!.id } : {}), body: { messages: page } }
  },
}


/** CI checks of a merge request behind the source-neutral ChangeChecks interface. */
export const gitlabChecks: ChangeChecks = {
  read: async (commands, change) => {
    if (!change.pipeline?.id) return { status: change.pipeline?.status ?? 'unknown', jobs: [] } satisfies CiSnapshot
    const jobs = await readJobs(commands, change.pipeline.id)
    return { status: change.pipeline.status, jobs: jobs.map(job => ({ name: job.name, status: job.status, allowFailure: !!job.allow_failure })) } satisfies CiSnapshot
  },
  summary: (snapshot, where, resource) => ciSummary(snapshot as CiSnapshot, where, resource),
  fact: snapshot => ciFact(snapshot as CiSnapshot),
}

/** Repository reads behind the source-neutral RepositoryRead interface. */
export const gitlabRepositoryRead: RepositoryRead = {
  read: (commands, path, kind) => readRepositoryPath(commands, path, kind),
}


/** The diff size and touched paths of one MR; used by the host merge gate for the second approval. */
export async function readChanges(commands: Commands, iid: number): Promise<{ additions: number; deletions: number; paths: string[] }> {
  const schema = z.looseObject({ changes: z.array(z.looseObject({ old_path: z.string().optional(), new_path: z.string().optional(), diff: z.string() })) })
  const data = await commands.gitlab(schema, `merge_requests/${iid}/changes`)
  let additions = 0, deletions = 0
  const paths: string[] = []
  for (const change of data.changes) {
    paths.push(change.new_path ?? change.old_path ?? '')
    for (const line of change.diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
    }
  }
  return { additions, deletions, paths }
}
