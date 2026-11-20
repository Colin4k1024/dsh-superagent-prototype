#!/usr/bin/env bash
# Apply a review gate to a GitLab project's default branch: protect it, require a successful pipeline, and optionally add
# a required approval rule (Premium). Free has no required approvals; the MR pipeline's review-gate job is the enforcement.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/apply-gitlab-review-gate.sh --project GROUP/PROJECT [options]

Options:
  --host URL           GitLab instance (default: https://gitlab.com)
  --branch NAME        Branch to protect (default: main)
  --approvals N        Add a required approval rule with N approvals (Premium; optional)
  --require-pipeline   Require a successful pipeline before merging
  --dry-run            Print the API calls and change nothing
  --glab PATH          glab executable (default: glab)
  -h, --help           Show this help

Bootstrap:
  1. Copy examples/gitlab/review-gate.mjs to .gitlab/scripts/review-gate.mjs
  2. Copy examples/gitlab/review-gate.yml into .gitlab-ci.yml
  3. Merge them while the default branch is unprotected
  4. Run this script; then run the review-gate job once on an MR
USAGE
}

PROJECT=""
HOST="https://gitlab.com"
BRANCH="main"
APPROVALS=""
REQUIRE_PIPELINE=false
DRY_RUN=false
GLAB="glab"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:?--project needs GROUP/PROJECT}"; shift 2 ;;
    --host) HOST="${2:?--host needs a URL}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch needs a name}"; shift 2 ;;
    --approvals) APPROVALS="${2:?--approvals needs a number}"; shift 2 ;;
    --require-pipeline) REQUIRE_PIPELINE=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --glab) GLAB="${2:?--glab needs a path}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
if [[ ! "$PROJECT" =~ ^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)+$ ]]; then echo "--project GROUP/PROJECT is required" >&2; exit 2; fi
if [[ -n "$APPROVALS" && ! "$APPROVALS" =~ ^[1-9][0-9]*$ ]]; then echo "--approvals must be a positive number" >&2; exit 2; fi
command -v "$GLAB" >/dev/null || { echo "$GLAB is required" >&2; exit 1; }
ENCODED=$(printf '%s' "$PROJECT" | sed 's|/|%2F|g')
HOSTNAME=$(printf '%s' "$HOST" | sed -E 's#^https?://##; s#/.*$##')
api() { "$GLAB" api "$1" --hostname "$HOSTNAME" "${@:2}"; }

echo "Project: $PROJECT ($HOST)"
echo "Protected branch: $BRANCH (Maintainers merge; agent stays Developer on agent/*)"
if [[ "$REQUIRE_PIPELINE" == true ]]; then echo "Require a successful pipeline before merge"; fi
if [[ -n "$APPROVALS" ]]; then echo "Required approvals: $APPROVALS (Premium or Ultimate)"; fi
echo
if [[ "$DRY_RUN" == true ]]; then
  cat <<JSON
POST projects/$ENCODED/protected_branches
  name=$BRANCH push_access_level=0 merge_access_level=40 allow_force_push=false
PUT projects/$ENCODED
  only_allow_merge_if_pipeline_succeeds=$REQUIRE_PIPELINE
JSON
  if [[ -n "$APPROVALS" ]]; then printf 'POST projects/%s/approval_rules\n  name=review-gate approvals_required=%s rule_type=regular\n' "$ENCODED" "$APPROVALS"; fi
  exit 0
fi

# Protect the merge target, not agent/*: protecting agent branches would block the agent from pushing.
if ! api "projects/$ENCODED/protected_branches/$BRANCH" >/dev/null 2>&1; then
  api "projects/$ENCODED/protected_branches" --method POST -f "name=$BRANCH" -f "push_access_level=0" -f "merge_access_level=40" -f "allow_force_push=false"
else
  api "projects/$ENCODED/protected_branches/$BRANCH" --method PUT -f "push_access_level=0" -f "merge_access_level=40" -f "allow_force_push=false"
fi

if [[ "$REQUIRE_PIPELINE" == true ]]; then
  api "projects/$ENCODED" --method PUT -f "only_allow_merge_if_pipeline_succeeds=true"
fi

if [[ -n "$APPROVALS" ]]; then
  # Approval rules are Premium; on Free this call fails and the MR pipeline job remains the only enforcement.
  if ! api "projects/$ENCODED/approval_rules" --method POST -f "name=review-gate" -f "approvals_required=$APPROVALS" -f "rule_type=regular"; then
    echo "Warning: approval rules are a Premium feature; keep the review-gate job and human merge on Free." >&2
  fi
fi

echo
api "projects/$ENCODED/protected_branches/$BRANCH"
