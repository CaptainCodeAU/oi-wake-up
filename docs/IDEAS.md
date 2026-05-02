# Ideas

Inbox for unstarted ideas. One bullet each, dated. Promote to `ROADMAP.md` when actioned.

- **Auto-detect MAC from ARP cache when host is reachable** (2026-05-01) — when invoking the planned `oi-wake-verify` against a host that's currently up, look up its MAC from the local ARP cache instead of requiring `--mac`. Removes the most-typed flag for already-awake force-restart scenarios.

- **Pre/post hook commands beyond `--remediate` and `--verify`** (2026-05-01) — `--before-wake` and `--after-verify` shell hooks for unattended notifications, model preloading, etc. Lets users extend the tool without forking.

- **Notification integration (Pushover / ntfy / Slack)** (2026-05-01) — for unattended wake-and-verify runs (cron, Home Assistant). Better delivered as an `--after-verify` hook (above) than as baked-in integrations.

- **Daemon / scheduler-aware retry mode** (2026-05-01) — systemd-timer-aware retry semantics, graceful interaction with cron-job overlap. Probably out of scope for `oi-wake-verify`; could be a separate tool.

- **Multi-target orchestration (`--all`)** (2026-05-01) — wake/remediate multiple hosts in one invocation. Becomes valuable only when 3+ machines need this regularly; YAGNI for now.

- **Surface probe stderr at default verbosity on probe failure** (2026-05-02, surfaced during oi-wake-verify real-world testing) — current behaviour buries the actual probe failure reason at `-d`. A user running the tool casually sees "unreachable" and assumes "box asleep" — but the actual stderr might be `Host key verification failed`, `Operation timed out`, `Permission denied (publickey)`, etc., each with a different fix path. Surfacing one line of the probe stderr at default verbosity when probe fails would have caught a real diagnostic loop during testing. SSH-territory agent's preferred primary fix because it doesn't paper over future failure classes — ship before any host-key-specific shortcut.

- **`--capture-verify` flag** (2026-05-02) — include the verify command's stdout in the structured JSON output regardless of verbosity. Today the `cold_ms=N hot_ms=N threshold_ms=N` line from `just warmup` is captured by `runRemote` but only printed at `-d`. Automation that wants to extract proof artifacts has to scrape `-d` output; with this flag, `oi-wake-verify --capture-verify --json | jq '.steps[] | select(.kind=="verify") | .stdout'` becomes a clean one-liner. ~30 LOC change in `bin/verify.js` + ~3 new tests. Strongest case of the polish bunch — and reinforced by the 3090 repo now shipping a second recipe (`just gpu-probe`) that uses the same `key=value` parseable-line discipline, so this flag pays off for any verify recipe that follows that convention.

- **`--accept-new-host` convenience flag** (2026-05-02) — *(dependency: ship only after `Surface probe stderr at default verbosity` above)*. Wraps `--ssh-opt StrictHostKeyChecking=accept-new` for first-run ergonomics. Today users hit a confusing `Host key verification failed` failure on first invocation against any new alias and have to drop to `-d` to discover it. Don't ship this in isolation — silently auto-accepting host keys the user can't see is worse than the current footgun. Pair with the stderr-surfacing fix.

- **`--forward-agent` flag** (2026-05-02) — pass `-A` to spawned ssh invocations for verify or remediate commands that need agent forwarding back to the originating host. Doesn't apply to `just warmup` (it's all `localhost:1234` on the box) but would matter if a verify ever grew a `git pull` or similar.

- **ICMP-pre-probe + SSH-probe two-stage liveness** (2026-05-02) — distinguishes "host asleep / off network" from "host reachable but SSH probe failed (host-key mismatch, auth failure, sshd down)". Today both look like "unreachable" at default verbosity, with very different fix paths. Two-stage probe: ICMP ping the IP first; if it succeeds, run the SSH probe; the result distinguishes which layer failed. Requires `node:net` socket-based ICMP or shelling to `ping` (latter portable, former needs root or capabilities). Largest design surface — write a fresh plan in `Plans/` before implementing.

## How to use this file

- Add ideas as one-liners with a date and a sentence of context.
- When you decide to action an idea, move it to `ROADMAP.md` under "Planned" with more detail. The `IDEAS.md` entry can stay (with a `→ ROADMAP` marker) or be removed — your call.
- No prioritisation here. This is an inbox, not a queue.
