# 009 Review gate

A review gate turns "a person should look at this" into a GitHub rule. It protects the branch that receives merges, not the
branch the agent pushes to. The agent must still be able to push `agent/<ticket>`; what needs a person is the merge into
`main`.

## What it enforces

- **At least one approval** from someone other than the pull request's author, with stale approvals dismissed when the
  author pushes again.
- **A second approval** when the pull request changes more than 200 lines (additions plus deletions) or touches a
  sensitive path: authentication, OAuth, audit, policy, approval, isolation, browser bindings, or database migrations.
- **The `review-gate` status check**, so the size/path rule cannot be skipped by merging with one approval.

The rules are deliberately in two layers. GitHub's native branch protection enforces one approval for every pull request.
The workflow (`examples/github/review-gate.yml` + `examples/github/review-gate.mjs`) computes the second-review rule from
the pull request's files and reviews. GitHub's native "required approvals" setting cannot vary by path or size, so the
workflow is the check that applies the stricter rule.

## Before enabling the second review

The second-review rule needs **two human accounts that can approve**. The agent account cannot approve a pull request it
authored, and the agent cannot be the second reviewer of its own work. A repository with one maintainer plus the agent
account (the current xiangzi setup) can satisfy the one-approval gate, but a required second approval would block every
large or sensitive agent pull request. Add a second reviewer account first, or keep the second-review workflow unrequired
and treat its red check as an advisory signal.

## Install

1. Copy the three files into the target repository:
   - `examples/github/review-gate.mjs` → `.github/scripts/review-gate.mjs`
   - `examples/github/review-gate.yml` → `.github/workflows/review-gate.yml`
   - `examples/github/review-gate.json` → `.github/review-gate.json`
2. Merge them while the default branch is still unprotected. The workflow needs to exist on the default branch before it
   can run on pull requests. This one merge is the bootstrap exception; do not make a habit of it.
3. Let the workflow run once on a pull request, so GitHub knows a check named `review-gate` exists.
4. Apply branch protection with the helper (requires repository admin):

   ```sh
   scripts/apply-review-gate.sh --repo OWNER/NAME --dry-run
   scripts/apply-review-gate.sh --repo OWNER/NAME --require-check
   ```

   `--require-check` requires the `review-gate` check in addition to one approval. If the repository has only one
   maintainer, keep the default `enforce_admins=false`: the maintainer can still merge their own pull request, while the
   agent account (a non-admin) cannot bypass the gate. `--enforce-admins` is stricter but can deadlock a one-person repo.

## Verify

```sh
gh api repos/OWNER/NAME/branches/main/protection \
  --jq '{required_pull_request_reviews, required_status_checks, enforce_admins}'
gh pr checks <number> --repo OWNER/NAME
```

A pull request from `agent/<ticket>` with one approval and a green `review-gate` check is mergeable. A pull request with
two approved reviews is mergeable even when the size/path rule asks for two. A pull request by the agent with zero
approvals is not mergeable by the agent account, even if it has write access to the repository.

## Why not protect `agent/*`?

Branch protection applies to pushes into the protected branch. If `agent/*` were protected, the agent could not push the
commits that make the pull request, and every ticket would need a human to create a branch. Protecting `main` is the
equivalent rule that only gates the merge.

## Limits

- An administrator with bypass rights can always merge without review; the workflow cannot prevent that. Use
  `--enforce-admins` only when the repository has at least two people who can approve.
- The workflow skips pull requests from forks (`pull_request` tokens cannot read reviews of a fork's base reliably). The
  agent pushes branches inside the watched repository, so this does not affect its workflow.
- A repository ruleset can replace branch protection if the organization prefers rulesets; the required check name stays
  `review-gate`.
- The gate proves a person approved, not that the approval was a careful review. Keep the pull request's verification
  section and read it; the gate is a floor, not a substitute for review.

## GitLab

GitLab's tiers change what the native settings can enforce:

- **Free**: approvals are optional; there are no required approval rules. Protect `main` with Maintainers as the only
  merge role, add the `review-gate` job to the MR pipeline, and enable **Pipelines must succeed**. The job fails without
  the required non-author approval; the protected branch keeps the agent from merging directly.
- **Premium/Ultimate**: add approval rules (one or two approvals), CODEOWNERS for sensitive paths, and external status
  checks. The `review-gate` job still computes the size/sensitive-path second approval, which approval rules cannot
  express by path or size.

Install:

1. Copy `examples/gitlab/review-gate.mjs` to `.gitlab/scripts/review-gate.mjs` and
   `examples/gitlab/review-gate.json` to `.gitlab/review-gate.json`.
2. Add the job from `examples/gitlab/review-gate.yml` to `.gitlab-ci.yml`; it runs only for merge request pipelines.
3. Merge the job while `main` is still unprotected, as with the GitHub workflow.
4. Run `scripts/apply-gitlab-review-gate.sh --project GROUP/PROJECT --dry-run`, then without `--dry-run`.
   `--require-pipeline` enables “Pipelines must succeed”; `--approvals N` adds a Premium approval rule.

The agent's worker token stays Developer and cannot merge `main`. If the deployment uses the host merge tool, the host
holds the Maintainer CLI (`mergeCli`) and merges only after the same gate; see the GitLab landing report §5.2.1.

Verify:

```sh
glab api "projects/GROUP%2FPROJECT/protected_branches/main" --hostname gitlab.example.com
glab api "projects/GROUP%2FPROJECT/merge_requests/IID/approvals" --hostname gitlab.example.com
glab api "projects/GROUP%2FPROJECT/pipelines/LATEST" --hostname gitlab.example.com
```

Limits specific to GitLab:

- A Maintainer or administrator can bypass protection; the gate is a floor, not a ceiling.
- The MR can change `.gitlab-ci.yml`. Keep the gate template in a protected central project with `include: project:`, or
  require a second approval when the MR touches the CI configuration. CODEOWNERS helps on Premium only.
- “Pipelines must succeed” with skipped pipelines treated as successful would defeat the gate; keep that setting off.
- Do not arm `merge_when_pipeline_succeeds` by default; if the team allows it, the host gate still checks approvals and
  the pipeline before merging.

## Related

- [002 Authorization](002-authorization.md): who may ask for work.
- [003 Execution](003-execution.md): what the Executor does, including the default no-auto-merge rule.
- [006 Deployment](006-deployment.md): installing and restarting the service.
