# Local GitLab test harness

Two ways to exercise the GitLab Source locally. Both keep the real `dsh-superagent` profile and Sessions; only the
GitLab endpoint differs.

## 1. Real GitLab in Docker (preferred when the image can be pulled)

`gitlab/docker-compose.yml` runs GitLab CE on `http://127.0.0.1:8929`, and `gitlab/bootstrap.sh` waits for readiness,
creates the agent/reviewer/merger accounts and tokens, seeds `dsh-test/widgets`, protects `main` for Maintainers and
requires a successful pipeline.

```sh
cd local-test/gitlab
docker compose up -d
./bootstrap.sh
```

On this machine the Docker pull did not finish: the official image has one 1.7 GB layer that the configured mirrors
could not deliver, so the bootstrap has not been run against a real container. The scripts are ready for a network where
`docker pull gitlab/gitlab-ce:18.5.0-ce.0` succeeds.

## 2. Fake GitLab API (works offline)

`gitlab-fake/server.mjs` implements the GitLab API paths dsh-superagent reads and writes: user/project, issues, notes,
MRs, approvals, pipelines, repository tree/raw, todos and merge. `gitlab-fake/bin/glab` is a shim that translates
`glab api ...` to that server, so `Commands` and the Source run unchanged.

```sh
# terminal 1: fake API
node local-test/gitlab-fake/server.mjs

# terminal 2: the GitLab test profile (created under ~/.dsh/profiles/superagent-gitlab)
dsh --profile superagent-gitlab --no-open
python3 local-test/configure-profile.py

# terminal 3: a canary run, posting as alice through the fake glab shim
DSH_FAKE_USER=alice node scripts/gitlab-mention-canary.mjs \
  --host http://127.0.0.1:8929 --project group/app --issue 7 --agent dsh-agent \
  --runs 3 --timeout 120 --interval 5 --glab "$PWD/local-test/gitlab-fake/bin/glab"
```

The profile uses `http://127.0.0.1:3083` and `~/.dsh/state/superagent-gitlab-local`.

Observed on 2026-11-20: the fake API flow captured **3/3** canary mentions, latency 61.3s / 50.9s / 61.1s
(p95 61.3s, target <120s); the worker replied on issue #7 with the `dsh-superagent:` marker and the ticket ended
`completed`. A note posted as the agent itself is ignored, as it should be.

## What this does and does not prove

- Proves: setup probing, GitLab API transport, polling, Trigger/Thread translation, policy gate, main-Session routing,
  worker acknowledgement/reply through the GitLab Channel, and canary detection.
- Does not prove: real Git HTTP clone/push, GitLab CI execution, real approval records, protected-branch merge, or
  Multi-project behaviour. Those need the real container (or GitLab.com) and the P1–P8 probes in the landing report.
- The fake API is intentionally in-memory; restarting it resets the fixture.
