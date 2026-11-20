export interface Change { old_path?: string; new_path?: string; diff?: string }
export interface Approver { user?: { username?: string }; username?: string }
export interface Approvals { approved_by?: Approver[] }
export interface ReviewGateConfig { maxLines?: number; sensitivePaths?: string[] }
export interface ReviewGateResult {
  passed: boolean
  required: number
  approvals: string[]
  lines: number
  large: boolean
  sensitive: string[]
  draft: boolean
  reason: string
}
export function matchPath(pattern: string, file: string): boolean
export function approversOf(approvals: Approvals | undefined, author?: string): string[]
export function changeStats(changes: Change[] | undefined): { lines: number; files: string[] }
export function evaluateGitlabReviewGate(input: { author?: string; draft?: boolean; changes?: Change[]; approvals?: Approvals }, config?: ReviewGateConfig): ReviewGateResult
export const apiUrl: (env?: NodeJS.ProcessEnv) => string
