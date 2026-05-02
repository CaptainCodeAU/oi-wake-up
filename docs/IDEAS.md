# Ideas

Inbox for unstarted ideas. One bullet each, dated. Promote to `ROADMAP.md` when actioned.

- **Auto-detect MAC from ARP cache when host is reachable** (2026-05-01) — when invoking the planned `oi-wake-verify` against a host that's currently up, look up its MAC from the local ARP cache instead of requiring `--mac`. Removes the most-typed flag for already-awake force-restart scenarios.

- **Pre/post hook commands beyond `--remediate` and `--verify`** (2026-05-01) — `--before-wake` and `--after-verify` shell hooks for unattended notifications, model preloading, etc. Lets users extend the tool without forking.

- **Notification integration (Pushover / ntfy / Slack)** (2026-05-01) — for unattended wake-and-verify runs (cron, Home Assistant). Better delivered as an `--after-verify` hook (above) than as baked-in integrations.

- **Daemon / scheduler-aware retry mode** (2026-05-01) — systemd-timer-aware retry semantics, graceful interaction with cron-job overlap. Probably out of scope for `oi-wake-verify`; could be a separate tool.

- **Multi-target orchestration (`--all`)** (2026-05-01) — wake/remediate multiple hosts in one invocation. Becomes valuable only when 3+ machines need this regularly; YAGNI for now.

## How to use this file

- Add ideas as one-liners with a date and a sentence of context.
- When you decide to action an idea, move it to `ROADMAP.md` under "Planned" with more detail. The `IDEAS.md` entry can stay (with a `→ ROADMAP` marker) or be removed — your call.
- No prioritisation here. This is an inbox, not a queue.
