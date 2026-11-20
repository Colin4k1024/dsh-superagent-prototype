/** The GitHub ForgePort: the existing pull-request, check and repository rules behind the source-neutral change interface. */
import { sameName } from '../infra/text.ts'
import { ciCounts, ciFact, ciSummary, pullChecks, readRepositoryPath, type CiSnapshot } from './github-read.ts'
import { claimPull, observePull, pullEndNotices, pullsOf, readPull, type Pull } from './github-pull.ts'
import { githubPage, SOURCE } from './github-trigger.ts'
import type { ChangeSnapshot, ForgePort } from './forge.ts'

/** Rebuilds the minimal Pull the existing claim and observe rules read; no field they do not use is invented. */
const pullOfChange = (change: ChangeSnapshot, repository: string): Pull => ({
  number: change.ref.number,
  state: change.state === 'open' ? 'open' : 'closed',
  merged: change.state === 'merged',
  html_url: change.url,
  user: { login: change.authorId },
  head: { sha: change.headSha ?? '', ref: change.headBranch ?? '',
    repo: change.sameProject ? { full_name: repository } : null },
  merged_at: change.mergedAt ?? null,
  closed_at: change.closedAt ?? null,
  auto_merge: change.autoMerge ? {} : null,
})

/** Projects a GitHub pull request onto the source-neutral snapshot. */
const changeOfPull = (pull: Pull, repository: string): ChangeSnapshot => ({
  ref: { kind: 'change', number: pull.number },
  state: pull.merged ? 'merged' : pull.state === 'closed' ? 'closed' : 'open',
  url: pull.html_url,
  authorId: pull.user.login,
  ...(pull.head.sha ? { headSha: pull.head.sha } : {}),
  ...(pull.head.ref ? { headBranch: pull.head.ref } : {}),
  ...(pull.base?.ref ? { baseBranch: pull.base.ref } : {}),
  sameProject: sameName(pull.head.repo?.full_name ?? '', repository),
  ...(pull.merged_at ? { mergedAt: pull.merged_at } : {}),
  ...(pull.closed_at ? { closedAt: pull.closed_at } : {}),
  ...(pull.auto_merge != null ? { autoMerge: true } : {}),
})

/** The GitHub code-host capability; the Source's own polling and Channel code stays in `github.ts`. */
export const githubForge: ForgePort = {
  kind: SOURCE,
  changeWord: 'PR',
  pageUrl: (repository, ref) => githubPage(repository, ref.number, true),
  change: {
    parse: thread => {
      if (!thread.startsWith(`${SOURCE}:`)) return undefined
      const number = Number(thread.slice(SOURCE.length + 1))
      return Number.isSafeInteger(number) && number > 0 ? { kind: 'change', number } : undefined
    },
    read: async (ctx, ref, signal) => changeOfPull(await readPull(ctx, ref.number, signal), ctx.deployment.repository),
    claim: (ctx, ticketId, change) => claimPull(ctx, ticketId, pullOfChange(change, ctx.deployment.repository)),
    observe: async (ctx, change) => observePull(ctx, pullOfChange(change, ctx.deployment.repository)),
    numbersOf: pullsOf,
    terminalNotices: (ctx, ticket, request) => pullEndNotices(ticket, request, ctx.deployment.repository),
  },
  checks: {
    read: (commands, change) => pullChecks(commands, change.headSha ?? ''),
    summary: (snapshot, where, resource) => ciSummary(snapshot as CiSnapshot, where, resource),
    fact: snapshot => ciFact(ciCounts(snapshot as CiSnapshot)),
  },
  repositoryRead: { read: (commands, path, kind) => readRepositoryPath(commands, path, kind) },
}
