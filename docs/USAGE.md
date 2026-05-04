# Usage Examples

Worked examples for both binaries, ordered most likely → least likely.

- **`oi-wake-up`** — sends the magic packet, nothing more.
- **`oi-wake-verify`** — sends the magic packet, waits for SSH, runs remediation, confirms recovery.

This is not a flag reference — run `oi-wake-up --help` or `oi-wake-verify --help` for the full option list. For troubleshooting (router config, BIOS settings, time-limited wake windows) see [README § Troubleshooting](../README.md#troubleshooting). MAC addresses, IPs, and usernames in the examples below are placeholders — substitute your own.

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

---

### 2. Send a magic packet

`oi-wake-up` — one-shot. No SSH probe, no waiting, no verify. Use when you'll SSH in manually after waking.

```bash
oi-wake-up AA:BB:CC:DD:EE:FF
```

---

### 3. Wake only — no SSH probe, no verify

`oi-wake-verify --wake-only` — sends the magic packet via `oi-wake-verify` without waiting for SSH. Use when you just need the machine to power on and will handle what follows yourself.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --wake-only
```

---

### 4. Force remediation on an already-awake host

`oi-wake-verify --force` — runs remediation even when SSH is already reachable. Use when the machine is awake but something broke (e.g. GPU passthrough failed after a monitor power-save, not a full system sleep).

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --force \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 5. Probe + remediate without sending a wake packet

`oi-wake-verify --no-wake` — skips the WoL packet entirely. Use when you know the machine is awake and only need to trigger remediation + verify.

```bash
oi-wake-verify mymachine \
    --no-wake \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 6. Wake a machine and wait for SSH — no remediation

`oi-wake-verify --no-restart` — wakes the machine and polls until SSH is up. No remediation, no verify. Use for machines whose services survive sleep without a restart.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --no-restart
```

---

### 7. Dry-run — inspect the plan without doing anything

`oi-wake-verify --dry-run -v` — print the steps that would run, based on current SSH reachability. `--dry-run` never probes SSH; it prints both the "already awake" plan and the "asleep" plan so you can sanity-check the alias before running it live.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF --dry-run -v \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 8. Subnet broadcast (when the global broadcast misses the NIC)

`oi-wake-up -i` — use your subnet's broadcast address instead of the default `255.255.255.255`, which is filtered by some routers and switches. The format is the last octet set to 255 on your local subnet.

```bash
oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF
```

See [README § Troubleshooting](../README.md#troubleshooting) for when this matters (ARP expiry, time-limited wake windows, managed switches).

---

### 9. Wake multiple boxes at once

`oi-wake-up` with multiple MACs — sends all packets over a single socket. `-d` adds a per-packet delay in milliseconds to spread the load across the network.

```bash
oi-wake-up -d 1000 AA:BB:CC:DD:EE:FF 11:22:33:44:55:66
```

---

### 10. Structured JSON output for automation

`oi-wake-verify --json` — writes a single JSON object to stdout on every run. Step progress goes to stderr, keeping stdout clean for piping.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'" \
    --json | jq .exit_code
```

Exit codes are a stable contract — branch on them from cron, Home Assistant, or shell wrappers. See [README § Exit codes](../README.md#exit-codes-stable-contract).

---

### 11. Append a journal log

`oi-wake-verify --journal` — appends one JSON record (JSONL) to a file on every run. Useful for cron wrappers, Home Assistant automations, or any consumer that needs a persistent audit trail. Combine with `--json` to also get the record on stdout.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'" \
    --journal ~/.local/share/oi-wake-verify.jsonl
```

---

### 12. Retry the wake on stubborn NICs

`oi-wake-verify --retry-wake` — if SSH never comes up within `--timeout`, re-sends the magic packet and re-polls up to N more times before giving up. Useful when the first packet arrives during switch MAC-table churn (common right after the NIC first powers on).

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --retry-wake 3 \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --verify   "bash -lc 'cd /home/adminuser/repos/myproject && just warmup'"
```

---

### 13. Cap captured output for chatty remediations

`oi-wake-verify --max-output` — truncates stdout + stderr captured from `--remediate` and `--verify` at the byte limit and appends `[output truncated]`. Default is 1 MiB (1048576). Protects against a runaway remediation script ballooning memory or flooding the journal.

```bash
oi-wake-verify mymachine --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/myproject && just restart'" \
    --max-output 65536
```

---

### 14. Print the magic packet without sending

`oi-wake-up --print-packet` — prints the 102-byte hex dump for a MAC address without sending anything. Use to cross-check the packet structure against a Wireshark capture or as a quick sanity check in CI.

```bash
oi-wake-up --print-packet AA:BB:CC:DD:EE:FF
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

One-shot wake alias:

```bash
# ~/.zshrc or ~/.bashrc
alias mymachine-wake='oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF'
```

Full wake + remediate + verify alias:

```bash
alias mymachine-recover='oi-wake-verify mymachine \
    --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc '\''cd ~/repos/myproject && just restart'\''" \
    --verify   "bash -lc '\''cd /home/adminuser/repos/myproject && just warmup'\''"'
```

See [README § Recommended setup](../README.md#recommended-setup-lean-on-sshconfig) for the canonical alias form and a note on why port 2522 (WSL-direct SSH) is preferred over port 22 (Windows OpenSSH) for Linux-side remediation.

---

## See also

- [README](../README.md) — full flag reference, prerequisites, troubleshooting tables
- [docs/GLOSSARY.md](GLOSSARY.md) — WoL terminology (`--grace`, magic packet, sync stream, `BatchMode`, host key entry, etc.)
- [docs/DECISIONS.md](DECISIONS.md) — design rationale (e.g. why `--grace` runs twice on the asleep path, why `--user` doesn't auto-default to `$USER`)
- [docs/ROADMAP.md](ROADMAP.md) — what's shipped and what's planned
