# 010 Reliability

This document covers three failure modes seen in real operation, and the defense now in the code: a mention that never
becomes a Trigger, one deleted thread that keeps the whole GitHub Source red, and one malformed session log that keeps
the whole profile from starting.

## Mentions that arrive late

GitHub notifications are indexed asynchronously. The Source advances a `since` cursor each poll; a notification that
becomes visible after the cursor has moved past its comment is never returned again. The observed failure was a burst of
three mentions in the same minute: all three were lost, and only a later mention of each Issue was ingested.

Two defenses now run together:

- **Lookback on the cursor.** The notification cursor and comment cursors step back by
  `mentionLookbackSeconds` (default 900 seconds), not five seconds. Re-reading is safe because Trigger IDs are
  deterministic and the Engine deduplicates them.
- **Repository-wide mention sweep.** Every poll reads recent `issues/comments` and `pulls/comments` and ingests only
  comments that mention the agent and are not already stored. This does not depend on the notification index. A sweep
  failure is a warning in the Source health detail, not a failed poll.

Both are configurable on the GitHub Source card: the lookback window is advanced (`提及回看窗口 / 秒`), and the sweep is
always on. The normal notification path is still the fast path; the sweep is the safety net.

### Mention canary

`scripts/mention-canary.mjs` posts a uniquely tagged mention on a dedicated canary Issue and waits for the agent's reply.
It reports per-run latency and p95, and exits non-zero when any run misses the timeout.

```sh
# One run, 120 seconds timeout, on a canary Issue that only the operator and the agent watch.
node scripts/mention-canary.mjs --repo OWNER/NAME --issue 123 --runs 1

# The acceptance run for the 20/20 target (up to ~40 minutes with the default timeout).
node scripts/mention-canary.mjs --repo OWNER/NAME --issue 123 --runs 20
```

Run it before a release, and optionally from a DSH schedule (for example every six hours). Keep the canary Issue small and
dedicated; do not use a real Issue, because the canary posts comments as the operator.

The acceptance line is 20/20 captured and a p95 confirmation under two minutes. The sweep runs on every poll, so the
capture path does not wait for a scheduled job.

## Deleted threads

A deleted Issue returns 404. The code retries 404 because it can also mean revoked access to a private repository. A
subscribed thread that keeps returning 404 used to fail every round forever, turning the whole GitHub Source red and
hiding real errors. After `threadFailuresBeforeQuarantine` consecutive 404s (default 3), the Source:

- stops polling that thread (`pollSuspended`);
- records `pollError` and the quarantine in the Source health detail;
- does not count the thread as a failed poll, so the rest of the Source stays ready;
- resumes the thread when a new mention or notification is read successfully.

Notification retries with the same 404 pattern are quarantined after the same number of attempts instead of being retried
forever. The read cursor is left in place, so a later successful read still takes in what the failed reads missed.

## Corrupt session logs at startup

A backup directory under `sessions/` whose header id does not match its directory name can make the DSH workspace
registry fail; the failure cascades through the session controller and blocks every component that waits for it. The
launcher now runs `scripts/session-preflight.py` before starting the service:

- moves `.bak-*`, `.tmp*` and dotted session directories to `$DSH_HOME/session-quarantine/<timestamp>/`;
- opens each remaining `session.v4.jsonl.zstd`, reads its first line, and quarantines the session when its `id` does not
  match the directory name;
- never moves a session while its service is running (the launcher only calls it before a start);
- prints what it moved, and continues if `zstd` is unavailable (backup directories are still moved).

```sh
python3 scripts/session-preflight.py --dry-run
python3 scripts/session-preflight.py
```

The preflight is a guard, not a repair: a quarantined session is preserved under `session-quarantine/` for inspection.
The real fix belongs in the session persistence layer, which should ignore non-session directories itself.

## Related

- [003 Execution](003-execution.md): polling, cursors and recovery.
- [007 Architecture](007-architecture.md): the Source and Store modules.
- [009 Review gate](009-review-gate.md): the merge gate that keeps a person in the delivery path.
