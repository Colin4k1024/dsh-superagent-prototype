---
name: dsh-superagent-gitlab
description: Read GitLab issues, merge requests, discussions, approvals and pipelines using glab.
---

Workers use glab for EVERY GitLab call: read issues, merge requests, notes, discussions, approvals and pipelines through
`glab api "projects/$PROJECT/..."`. Set `PROJECT` to `$DSH_SUPERAGENT_GITLAB_PROJECT` with `/` written as `%2F`
(for example `group%2Fapp`); the host is `$DSH_SUPERAGENT_GITLAB_HOST` and the agent account is
`$DSH_SUPERAGENT_GITLAB_ACCOUNT`. Never use the web UI or a personal browser session as the agent.

Read before editing:

- one Issue: `glab api "projects/$PROJECT/issues/<iid>"`
- one merge request: `glab api "projects/$PROJECT/merge_requests/<iid>"`
- its notes: `glab api "projects/$PROJECT/merge_requests/<iid>/notes?per_page=100&sort=desc"`
- its review discussions: `glab api "projects/$PROJECT/merge_requests/<iid>/discussions?per_page=100"`
- its approvals: `glab api "projects/$PROJECT/merge_requests/<iid>/approvals"`
- its pipeline and jobs: `glab api "projects/$PROJECT/merge_requests/<iid>"` (`head_pipeline`), then
  `glab api "projects/$PROJECT/pipelines/<pipeline_id>/jobs?per_page=100"`

A merge request's iid is not an Issue iid: write `!<iid>` for a merge request and `#<iid>` for an Issue. The Thread keys
are `gitlab:mr:<iid>` and `gitlab:issue:<iid>`.

Creating and updating work:

- Branch from the ticket's base branch as `agent/<ticket-name>`; commit as `$DSH_SUPERAGENT_GITLAB_COMMIT_EMAIL`.
- Open: `glab mr create --source-branch agent/<name> --target-branch <base> --title "<title>" --description "<body>"`.
- Comment: `glab api "projects/$PROJECT/issues/<iid>/notes" --method POST -f "body=<text>"`, or the merge_requests path.
- Reply in a discussion: `glab api "projects/$PROJECT/merge_requests/<iid>/discussions/<discussion_id>/notes" --method POST -f "body=<text>"`.
- Resolve a discussion: `glab api "projects/$PROJECT/merge_requests/<iid>/discussions/<discussion_id>" --method PUT -f "resolved=true"`.
- Do not append a leading `/` to a note body; GitLab would execute it as a quick action. The host escapes this for replies,
  but CLI calls are yours.

Approvals and merging:

- Approval is a GitLab approval, not a comment that says "approved": read `/approvals` and report the approval state.
- The worker token is Developer and cannot merge the protected default branch. After the MR is ready, has a non-author
  approval and a successful pipeline, call `orchestrator_merge_request`; the host checks the same gate with a Maintainer
  CLI. Never call `glab mr merge` directly.
- Do not arm `merge_when_pipeline_succeeds`; the host merges only after reading the current head, approval and pipeline.

Before substantial work on a new human request or review comment, call `orchestrator_ack` with its original trigger ID and
a brief request-specific `text`; do not acknowledge bots, CI or system notes. Answer review comments as the Communication
section says; use the discussion reply path for a review thread, not a new top-level note. Record the bot run identifier,
review-round count and dispositions in `orchestrator_report`; the MR description keeps the final implementation,
verification and material limitations.

The host delivers subscribed MR comments, approvals and pipeline changes directly to the bound worker. Immediately after
creating or adopting a ticket MR, call `orchestrator_report` with `state: progress` and `change_number`; do not wait for
CI or handoff. Read each original trigger and acknowledge new human requests before substantial work.
