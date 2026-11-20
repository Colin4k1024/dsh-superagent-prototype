/** Code-host capability a Source kind may publish: change binding, checks, repository reads and terminal notices for the generic layer. */
import type { OutboundMessage, Text, ThreadFact, Ticket } from '../core/index.ts'
import type { Commands } from '../infra/commands.ts'
import type { SourceContext } from './host.ts'

/** The kind of code-host change a Thread follows; GitHub calls it a pull request, GitLab a merge request. */
export type ChangeKind = 'change'
/** One change on the code host; `number` is a pull-request number on GitHub and a merge-request iid on GitLab. */
export interface ChangeRef { kind: ChangeKind; number: number }
/**
 * Source-neutral facts about one change. Each Source fills the fields its code host provides and omits the rest;
 * `sameProject` is true when the change's source and target projects are the same, which a fork is not.
 */
export interface ChangeSnapshot {
  ref: ChangeRef
  state: 'open' | 'merged' | 'closed' | 'locked'
  url: string
  authorId: string
  headSha?: string
  headBranch?: string
  baseBranch?: string
  sameProject: boolean
  draft?: boolean
  mergedAt?: string
  closedAt?: string
  /** GitHub's auto-merge is armed, or GitLab's merge-when-pipeline-succeeds is set. */
  autoMerge?: boolean
  approvals?: { approvedBy: string[]; required?: number }
  pipeline?: { status: string; id?: number; url?: string }
  /** True when GitLab reports the change mergeable (no conflicts and its merge checks pass). */
  mergeable?: boolean
  /** Diff size and touched paths, when the Source can read them; the merge gate uses them for the second approval. */
  changes?: { additions: number; deletions: number; paths: string[] }
}

/** How a Source binds changes to tickets; the Source owns the Thread format and the page URL. */
export interface ChangeBinding {
  /** Reads a change number from one of this Source's Thread keys; a Thread that is not a change yields undefined. */
  parse(thread: string): ChangeRef | undefined
  /** Reads one change, or throws when it cannot be read. */
  read(ctx: SourceContext, ref: ChangeRef, signal?: AbortSignal): Promise<ChangeSnapshot>
  /** Validates and binds a change to an open ticket; a refusal is returned as a sentence for the model. */
  claim(ctx: SourceContext, ticketId: string, change: ChangeSnapshot): string | undefined
  /** Reconciles a polled change with its tickets and the domain; answers whether the change has ended. */
  observe(ctx: SourceContext, change: ChangeSnapshot): Promise<boolean>
  /** The change numbers a ticket follows, `openOnly` excluding changes whose close the ticket recorded. */
  numbersOf(ticket: Pick<Ticket, 'follows'>, openOnly?: boolean): number[]
  /** Terminal notices to the ticket's non-code-host channels, such as a Feishu chat. */
  terminalNotices(ctx: SourceContext, ticket: Ticket, request: string): OutboundMessage[]
  /** Host-side merge; only a Source with a separate maintainer CLI provides it. */
  merge?(ctx: SourceContext, change: ChangeSnapshot, options?: { sha?: string }): Promise<void>
}

/** CI checks of a change; each Source decides its own snapshot shape and how it is shown. */
export interface ChangeChecks {
  read(commands: Commands, change: ChangeSnapshot, signal?: AbortSignal): Promise<unknown>
  /** One model-facing line: what failed, what still runs, and where to read every check. */
  summary(snapshot: unknown, where: string, resource: string): string
  /** The Thread fact a Source publishes for the snapshot. */
  fact(snapshot: unknown): ThreadFact
}

/** Read-only access to a repository's files and directories, for assessments and workers. */
export interface RepositoryRead {
  read(commands: Commands, path: string, kind: 'file' | 'directory', signal?: AbortSignal): Promise<string>
}

/**
 * What a Source kind publishes to the generic layer about its code host.
 * A kind without `forge` has no pull requests, checks or repository reads, as Feishu has none.
 */
export interface ForgePort {
  /** The Source kind id that owns this capability, such as `github` or `gitlab`. */
  readonly kind: string
  /** The word people use for a change on this host, such as PR or MR. */
  readonly changeWord: Text
  /** The web page of one change in `project`; `host` is the code host's base URL when it is not the default. */
  pageUrl(project: string, ref: ChangeRef, host?: string): string
  readonly change: ChangeBinding
  readonly checks?: ChangeChecks
  readonly repositoryRead?: RepositoryRead
}

/** A ticket's code host together with the context its Forge methods need. */
export interface ForgeTarget { source: string; forge: ForgePort; context: SourceContext }
