For every ticket that changes UI, the MR description must contain BOTH Before and After visual evidence, clearly labelled, with the baseline and changed revision identified.
Capture the same scenario, viewport, theme and relevant UI state so the comparison is meaningful; screenshots or demonstrations are acceptable.
After-only evidence is incomplete.
Use actual application captures, not a mockup presented as the previous implementation, and do not expose private Feishu content or credentials.
Refresh the comparison when later UI changes make it stale.
If a real baseline capture is unavailable, state the missing evidence and limitation honestly, keep the handoff incomplete, and do not claim the UI MR is ready.
Workers capture and verify the comparison; the orchestrator checks the reported evidence before delivering a ready result.

Request the reviews that the matched rules, the assignment, these prompts or repository instructions ask for.
The worker token cannot merge the protected default branch. After the merge request is ready, a person other than its author has approved it and its pipeline is successful, call `orchestrator_merge_request` with the current head SHA and the evidence; the host applies the merge gate (approvals, pipeline, size, sensitive paths, head SHA) and merges through a Maintainer CLI. Never call `glab mr merge` yourself and never arm `merge_when_pipeline_succeeds`.
If the gate refuses, report its reason and let a person act; do not merge around it.
Report ready without waiting for approval or merge.
Never approve or merge on behalf of a reviewer.
Credit each person who reviews a merge request you opened, once per merge request, when their feedback is first assessed: add a `Co-authored-by` trailer with that person's GitLab commit email when it is known, otherwise record `Reviewed-by: @<username>` in the merge request description and in `orchestrator_report`; do not invent an email.
Do not credit bots, the merge request's author, the agent account, or the person these instructions name as commit author, who is already credited as the author of every commit.
Record whom you have credited in `orchestrator_report`, so a later worker does not credit them again.
If a human is working on the same problem and their branch or merge request contains this ticket's code (commits from the ticket branch, or its changes carried over), close this ticket's merge request with `glab mr close <iid>` immediately without asking anyone, leaving one sentence on it that names the human's merge request.
Work that is only related, or does not contain the ticket's code, is not a reason to close.
Closing the merge request ends the ticket; send no other message.
If a human is working on the same problem and their branch or MR contains this ticket's code (commits from the ticket branch, or its changes carried over), close this ticket's MR with glab immediately without asking anyone, leaving one sentence on it that names the human's MR.
Work that is only related, or does not contain the ticket's code, is not a reason to close.
Closing the MR ends the ticket; send no other message.
