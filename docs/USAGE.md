# Usage Examples

Worked examples for all three binaries, ordered most likely → least likely.

- **`oi-wake-up`** — sends the magic packet, nothing more.
- **`oi-wake-verify`** — sends the magic packet, waits for SSH, runs remediation, confirms recovery.
- **`oi-wake-down`** — sends a sleep command via SSH, confirms the host went unreachable.

**`oi-wake-verify` does not replace `oi-wake-up`.** Both share the same WoL core (`src/index.js`), but `oi-wake-verify` only exposes the narrow WoL surface its SSH-probe workflow needs. Capabilities exclusive to `oi-wake-up`: subnet broadcast (`-i`), non-default UDP port (`-p`), MAC list from file (`-f`), inter-packet delay for multi-MAC sends (`-d`), quiet mode (`-q`), and waking multiple machines in one invocation. If you need any of these, use `oi-wake-up` directly.

This is not a flag reference — run `oi-wake-up --help`, `oi-wake-verify --help`, or `oi-wake-down --help` for the full option list. For troubleshooting (router config, BIOS settings, time-limited wake windows) see [README § Troubleshooting](../README.md#troubleshooting). MAC addresses, IPs, and usernames in the examples below are placeholders — substitute your own.

---

### 1. Wake a machine and recover GPU passthrough

`oi-wake-verify` — the canonical use case. If Windows sleep/wake silently drops the docker container's GPU passthrough, this collapses *wake → SSH → restart container → confirm GPU is back* into one idempotent command. If the machine is already awake and healthy, it exits 0 without sending the magic packet.

```bash
oi-wake-verify mymachine \
    --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

**On `--grace`:** the default of 10 seconds runs twice on the wake-and-remediate path — once after SSH comes up (services may not be ready yet), once after `--remediate` completes (a just-restarted container needs settle time). Raise it if your `--verify` command can't handle its own readiness polling.

**On `bash -lc '…'`:** SSH non-interactive sessions skip the usual shell startup files. If the target's default shell is zsh and your tools (`just`, project scripts, etc.) are only on PATH via bash's profile, the command fails with `command not found`. Wrapping in `bash -lc '…'` forces a bash login shell with full PATH initialisation. Safe even when the target's default shell is already bash.

**On the host going back to sleep ~2 min after waking:** if the box wakes but becomes unreachable again about two minutes later, that's the Windows **System unattended sleep timeout** (default 120s) returning it to sleep after an unattended (WoL) wake — not a failed wake, and an SSH session won't keep it awake. One-time host fix: `powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP 7bc4a2f9-d8fc-4469-b07b-33eb785aaca0 0 && powercfg /setactive SCHEME_CURRENT`. See [README § Troubleshooting](../README.md#machine-wakes-then-goes-back-to-sleep-2-minutes-later) and [GLOSSARY](GLOSSARY.md).

---

### 2. Put the machine to sleep

`oi-wake-down` — send a sleep command via SSH and confirm the host went unreachable. Idempotent — if the machine is already asleep, exits 0 with no action. Pairs naturally with `oi-wake-verify`: use `wakeup` to bring the box up, `sleepy` to put it back down.

```bash
oi-wake-down mymachine
```

**Default sleep command (Windows via WSL):** `/mnt/c/Windows/System32/rundll32.exe powrprof.dll,SetSuspendState 0,1,0`. Override with `--command` for other platforms (Linux: `systemctl suspend`, macOS: `pmset sleepnow`).

**On `--no-confirm`:** by default `oi-wake-down` polls SSH until the host becomes unreachable before exiting — proof the sleep took effect. Pass `--no-confirm` for fire-and-forget.

**Gotcha — hibernate vs. sleep:** if Windows hibernation is enabled (`powercfg /h on`), `SetSuspendState` silently hibernates instead of sleeping. One-time fix on the Windows side: `powercfg /h off`. WoL still works from hibernate, but wake times are longer.

---

### 3. Send a magic packet

`oi-wake-up` — one-shot. No SSH probe, no waiting, no verify. Use when you'll SSH in manually after waking.

```bash
oi-wake-up AA:BB:CC:DD:EE:FF
```

---

### 4. Wake only — no SSH probe, no verify

`oi-wake-verify --wake-only` — sends the magic packet via `oi-wake-verify` without waiting for SSH. Use when you just need the machine to power on and will handle what follows yourself.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --wake-only
```

---

### 5. Force remediation on an already-awake host

`oi-wake-verify --force` — runs remediation even when SSH is already reachable. Use when the machine is awake but something broke (e.g. GPU passthrough failed after a monitor power-save, not a full system sleep).

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --force \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 6. Probe + remediate without sending a wake packet

`oi-wake-verify --no-wake` — skips the WoL packet entirely. Use when you know the machine is awake and only need to trigger remediation + verify.

```bash
oi-wake-verify mymachine \
    --no-wake \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 7. Wake a machine and wait for SSH — no remediation

`oi-wake-verify --no-restart` — wakes the machine and polls until SSH is up. No remediation, no verify. Use for machines whose services survive sleep without a restart.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --no-restart
```

---

### 8. Dry-run — inspect the plan without doing anything

`oi-wake-verify --dry-run -v` — print the steps that would run, based on current SSH reachability. `--dry-run` never probes SSH; it prints both the "already awake" plan and the "asleep" plan so you can sanity-check the alias before running it live.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --dry-run -v \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 9. Subnet broadcast (when the global broadcast misses the NIC)

`oi-wake-up -i` — use your subnet's broadcast address instead of the default `255.255.255.255`, which is filtered by some routers and switches. The format is the last octet set to 255 on your local subnet.

```bash
oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF
```

See [README § Troubleshooting](../README.md#troubleshooting) for when this matters (ARP expiry, time-limited wake windows, managed switches).

---

### 10. Wake multiple boxes at once

`oi-wake-up` with multiple MACs — sends all packets over a single socket. `-d` adds a per-packet delay in milliseconds to spread the load across the network.

```bash
oi-wake-up -d 1000 AA:BB:CC:DD:EE:FF 11:22:33:44:55:66
```

---

### 11. Structured JSON output for automation

`oi-wake-verify --json` — writes a single JSON object to stdout on every run. Step progress goes to stderr, keeping stdout clean for piping.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'" \
    --json | jq .exit
```

Every record carries top-level `ts` (run start) and `finishedAt` (run end) as ISO-8601 UTC — use them to order and correlate runs (also present on `oi-wake-down`, and on the signal-kill flush). Add `--capture-wake-source` to also get a top-level `wakeSource` object (see example 17), and `--capture-verify` to fold each step's `stdout`/`stderr` into the record (example 18). Exit codes are a stable contract — branch on them from cron, Home Assistant, or shell wrappers. See [README § Exit codes](../README.md#exit-codes-stable-contract).

---

### 12. Append a journal log

`oi-wake-verify --journal` — appends one JSON record (JSONL) to a file on every run. Useful for cron wrappers, Home Assistant automations, or any consumer that needs a persistent audit trail. Combine with `--json` to also get the record on stdout.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'" \
    --journal ~/.local/share/oi-wake-verify.jsonl
```

---

### 13. Retry the wake on stubborn NICs

`oi-wake-verify --retry-wake` — if SSH never comes up within `--timeout`, re-sends the magic packet and re-polls up to N more times before giving up. Useful when the first packet arrives during switch MAC-table churn (common right after the NIC first powers on).

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --retry-wake 3 \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 14. Cap captured output for chatty remediations

`oi-wake-verify --max-output` — truncates stdout + stderr captured from `--remediate` and `--verify` at the byte limit and appends `[output truncated]`. Default is 1 MiB (1048576). Protects against a runaway remediation script ballooning memory or flooding the journal.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --max-output 65536
```

---

### 15. Print the magic packet without sending

`oi-wake-up --print-packet` — prints the 102-byte hex dump for a MAC address without sending anything. Use to cross-check the packet structure against a Wireshark capture or as a quick sanity check in CI.

```bash
oi-wake-up --print-packet AA:BB:CC:DD:EE:FF
```

---

### 16. Cap a hung remediate or verify

`oi-wake-verify --remediate-timeout` / `--verify-timeout` — SIGKILL the remediate or verify command if it runs past the given number of seconds, failing cleanly with exit 4 / 5 (`… timed out after Ns`) instead of blocking. Off by default (`0`). Useful for unattended runs where a `just restart` could hang or a verify could wedge. Set each cap above the command's legitimate worst case — a slow restart, a cold model load.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd ~/repos/myproject && just warmup'" \
    --remediate-timeout 60 --verify-timeout 90
```

The `--remediate`/`--verify` SSH connections also always carry `ConnectTimeout=10` + `ServerAliveInterval=5`/`ServerAliveCountMax=3`, so a stalled connect or a silently-dropped channel fails in ~10–15s rather than riding OpenSSH's ~120s default — the failure mode that bites in the fragile window right after a WoL wake.

---

### 17. Attribute the wake — was it us, or something else? (`--capture-wake-source`)

`oi-wake-verify --capture-wake-source` — after a wake-and-up run, runs the read-only `powercfg /lastwake` over the existing SSH channel and attaches a top-level `wakeSource` object to the `--json`/`--journal` record. The Windows attribution key: if `/lastwake` names the NIC, our magic packet woke the box; if it names a Power Button or another device, the box was coming up anyway. Read-only — never changes power policy. Windows/WSL targets only; on anything else the capture is recorded as `captured:false` and the run is unaffected (never fatal).

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --capture-wake-source --json | jq '.wakeSource'
```

The capture only runs when a wake was actually performed (it fires as soon as SSH is up, before remediation restarts anything, so `/lastwake` still reflects this run's wake). On an already-awake host (no wake) it records `{performedWake:false, captured:false, reason:"..."}` instead of reporting a stale prior wake — so a consumer can tell "no wake this run" apart from "captured: external device" by the `captured` boolean.

---

### 18. Capture verify/remediate output for automation (`--capture-verify`)

`oi-wake-verify --capture-verify` — include the `--remediate` and `--verify` command `stdout`/`stderr` in the structured records regardless of verbosity, so automation can extract proof artifacts (e.g. the `cold_ms=N hot_ms=N threshold_ms=N` line from `just warmup`) without scraping `-d`. Bounded by `--max-output`.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --verify "bash -lc 'cd ~/repos/myproject && just warmup'" \
    --capture-verify --json | jq -r '.steps[] | select(.kind=="verify") | .stdout'
```

---

### 19. Probe-only liveness check (`--status`)

`oi-wake-verify --status` — probe SSH and report reachable/unreachable, then exit 0 either way. No wake, no remediation, and (unlike `--no-wake --no-restart`, which aborts with exit 3 when unreachable) no error on an unreachable host. `--mac` is not required. Useful for monitoring scripts and Home Assistant sensors that just want a boolean "is the box up".

```bash
oi-wake-verify mymachine --status --json | jq -r '.state'   # -> reachable | unreachable
```

---

### 20. Explicit ssh config file (`-F` / `--ssh-config`)

`oi-wake-verify -F <path>` — forward an explicit ssh config to `ssh -F <path>`, for contexts where `~/.ssh/config` isn't readable: systemd units with `ProtectHome=true`, cron, containers. Collapses the manual decomposition (`--ssh-port`, `-i`, `--ssh-opt User=…`, `--ssh-opt UserKnownHostsFile=…`) back into a single config file. Applies to the probe, remediate, verify, and wake-source channels. `oi-wake-down` accepts the same `-F`/`--ssh-config` for callers that drive both the wake and sleep sides.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF -F /etc/oi-wake/ssh_config \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'"
```

---

## Shell aliases

Define SSH connection details once in `~/.ssh/config`, then the alias only carries the wake/remediate bits:

```sshconfig
# ~/.ssh/config
Host mymachine
    HostName        192.168.1.10
    User            youruser
    Port            2522
    IdentityFile    ~/.ssh/mymachine
    IdentitiesOnly  yes
```

**Note on `--user`:** when `--user` is omitted from `oi-wake-verify`, SSH resolves the user from the `User` directive in the matching `~/.ssh/config` Host block (falling back to `$USER` if no Host block matches). Do not pass `--user youruser` if you already have it in `~/.ssh/config` — the flag would override the config, not complement it.

One-shot wake alias (magic packet only, no SSH):

```bash
# ~/.zshrc or ~/.bashrc
alias wakeup-quick='oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF'
```

Full wake + remediate + verify alias (the real daily-driver):

```bash
alias wakeup='oi-wake-verify mymachine \
    --mac AA:BB:CC:DD:EE:FF \
    --broadcast 192.168.1.255 \
    --remediate "bash -lc '\''cd ~/repos/myproject && just restart'\''" \
    --verify   "bash -lc '\''cd /home/youruser/repos/myproject && just warmup'\''" \
    --remediate-timeout 60 --verify-timeout 90'
```

`--remediate-timeout`/`--verify-timeout` (seconds) are optional safety caps — they SIGKILL a hung remediate/verify and fail cleanly (exit 4/5) rather than blocking forever. Off by default (`0`); set each above its command's legitimate worst case (a slow `docker compose restart`, a cold model load). The remediate/verify SSH connections also always carry `ConnectTimeout=10` + `ServerAliveInterval=5`/`ServerAliveCountMax=3`, so a stalled connect or dropped channel fails in ~10–15s instead of OpenSSH's ~120s default.

Sleep alias — put the machine back down when done:

```bash
alias wakedown='oi-wake-down mymachine'
```

See [README § Recommended setup](../README.md#recommended-setup-lean-on-sshconfig) for the canonical alias form and a note on why port 2522 (WSL-direct SSH) is preferred over port 22 (Windows OpenSSH) for Linux-side remediation.

---

## See also

- [README](../README.md) — full flag reference, prerequisites, troubleshooting tables
- [docs/GLOSSARY.md](GLOSSARY.md) — WoL terminology (`--grace`, magic packet, sync stream, `BatchMode`, host key entry, wake source, etc.)
- [docs/AGENT_BRIEF.md](AGENT_BRIEF.md) — self-contained connection brief for an LLM agent / automation (flag tables, `--json` schema incl. `wakeSource`, gotchas)
- [docs/DECISIONS.md](DECISIONS.md) — design rationale (e.g. why `--grace` runs twice on the asleep path, why `--user` doesn't auto-default to `$USER`)
- [docs/ROADMAP.md](ROADMAP.md) — what's shipped and what's planned
