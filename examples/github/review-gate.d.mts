export interface Review {
  user?: { login?: string }
  login?: string
  state?: string
}
export interface PullFacts {
  author?: string
  user?: { login?: string }
  additions?: number
  deletions?: number
  files?: string[]
}
export interface ReviewGateConfig {
  maxLines?: number
  sensitivePaths?: string[]
}
export interface ReviewGateResult {
  passed: boolean
  required: number
  approvals: string[]
  lines: number
  large: boolean
  sensitive: string[]
  reason: string
}
export function matchPath(pattern: string, file: string): boolean
export function latestApprovals(reviews: Review[]): string[]
export function evaluateReviewGate(pull: PullFacts, reviews: Review[], config?: ReviewGateConfig): ReviewGateResult
