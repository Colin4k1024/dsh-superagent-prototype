#!/usr/bin/env bash
# Apply a review gate to a repository's default branch (branch protection + the required review-gate check).
# The gate protects the merge target (`main`), not `agent/*`: protecting agent branches would block the agent from pushing.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/apply-review-gate.sh --repo OWNER/NAME [options]

Options:
  --branch NAME          Branch to protect (default: main)
  --require-check        Also require the `review-gate` status check (install the workflow first)
  --enforce-admins       Make branch protection apply to admins too (may deadlock a single-maintainer repo)
  --dry-run              Print the API payload and change nothing
  -h, --help             Show this help

Bootstrap order:
  1. Copy examples/github/review-gate.mjs to .github/scripts/review-gate.mjs
  2. Copy examples/github/review-gate.yml to .github/workflows/review-gate.yml
  3. Copy examples/github/review-gate.json to .github/review-gate.json
  4. Merge those files; let the workflow run once on a pull request
  5. Run this script with --require-check
USAGE
}

REPO=""
BRANCH="main"
REQUIRE_CHECK=false
ENFORCE_ADMINS=false
DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="${2:?--repo needs OWNER/NAME}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch needs a name}"; shift 2 ;;
    --require-check) REQUIRE_CHECK=true; shift ;;
    --enforce-admins) ENFORCE_ADMINS=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "--repo must be OWNER/NAME" >&2
  exit 2
fi
command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }

if [[ "$REQUIRE_CHECK" == true ]]; then
  STATUS_CHECKS='{"strict":true,"contexts":["review-gate"]}'
else
  STATUS_CHECKS='null'
fi

PAYLOAD=$(cat <<JSON
{
  "required_status_checks": $STATUS_CHECKS,
  "enforce_admins": $ENFORCE_ADMINS,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
)

echo "Repository: $REPO"
echo "Protected branch: $BRANCH (the merge target; agent/* stays writable by the agent)"
echo "Required approvals: 1 (from someone other than the PR author; stale approvals dismissed on push)"
if [[ "$REQUIRE_CHECK" == true ]]; then echo "Required status check: review-gate"; fi
if [[ "$ENFORCE_ADMINS" == true ]]; then echo "Admins are subject to the gate."; else echo "Admins may bypass the gate; the agent account cannot."; fi
echo
if [[ "$DRY_RUN" == true ]]; then
  echo "$PAYLOAD"
  exit 0
fi

if ! gh api "repos/$REPO/branches/$BRANCH/protection" >/dev/null 2>&1; then
  echo "Note: $BRANCH is not protected yet; the next call enables protection."
fi
printf '%s' "$PAYLOAD" | gh api --method PUT "repos/$REPO/branches/$BRANCH/protection" --input -
echo
gh api "repos/$REPO/branches/$BRANCH/protection" --jq '{required_status_checks, enforce_admins, required_pull_request_reviews, required_conversation_resolution, allow_force_pushes, allow_deletions}'
