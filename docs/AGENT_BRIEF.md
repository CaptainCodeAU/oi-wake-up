# oi-wake-up — Agent Connection Brief

Audience: an LLM agent or script running on the same LAN as the target
machine, calling `oi-wake-up` and/or `oi-wake-verify` to wake a sleeping host
and (optionally) run a post-wake remediation. Self-contained — read only this
file. Examples are shell-first; a Node library surface is also documented.

## Entry points

This project is a pair of CLI binaries plus a small Node library. There is no
HTTP service, no daemon, no listener — every interaction is a one-shot
process invocation.

| Binary             | Role                                                     | Source             |
| ------------------ | -------------------------------------------------------- | ------------------ |
| `oi-wake-up`       | Send a Wake-on-LAN magic packet (UDP broadcast)          | `bin/cli.js`       |
| `oi-wake-verify`   | Wake → SSH probe → wait → grace → remediate → verify     | `bin/verify.js`    |
| Library (`import`) | `wake`, `createMagicPacket`, `parseMAC`, `isValidMAC`    | `src/index.js`     |

Install once:

```bash
pnpm add -g github:CaptainCodeAU/oi-wake-up
# bun add -g github:CaptainCodeAU/oi-wake-up    # also fine
# npm is NOT supported by this project
```

After install, both binaries are on `PATH`. Requires Node >= 18.

Library import (when consumed from another Node project):

```bash
pnpm add github:CaptainCodeAU/oi-wake-up
```

```javascript
import { wake, isValidMAC, parseMAC, createMagicPacket } from 'oi-wake-up';
```

## Surface area — `oi-wake-up`

Magic-packet sender. UDP, no SSH, no return-channel — fire and forget.

```
oi-wake-up [options] <mac> [mac...]
```

| Flag                  | Default              | Purpose                                  |
| --------------------- | -------------------- | ---------------------------------------- |
| `-i, --address <ip>`  | `255.255.255.255`    | Destination IP (use subnet broadcast — see Gotcha #5) |
| `-p, --port <n>`      | `9`                  | Destination UDP port (some NICs prefer `7`) |
| `-q, --quiet`         | off                  | Suppress per-packet stdout               |
| `-f, --file <path>`   | —                    | Read MACs from file (`MAC [IP] [PORT]` per line, `#` comments) |
| `-d, --delay <ms>`    | `0`                  | Delay between packets when sending many  |
| `-v, --version`       |                      | Print version, exit 0                    |
| `-h, --help`          |                      | Print help, exit 0                       |

Exit: `0` on success (≥1 packet sent); `1` on misconfig, file error, or zero
valid MACs supplied. Invalid MACs in a batch produce a `Warning: Invalid MAC
address: …` to stderr but do not abort the run as long as ≥1 valid MAC is
present.

## Surface area — `oi-wake-verify`

Idempotent wake + SSH probe + remediation orchestrator. Does **nothing** by
default if the host is already reachable.

```
oi-wake-verify <host> [options]
```

| Group        | Flag                       | Default              | Purpose |
| ------------ | -------------------------- | -------------------- | ------- |
| Wake         | `-m, --mac <mac>`          | —                    | Required unless `--no-wake` |
| Wake         | `-b, --broadcast <ip>`     | `255.255.255.255`    | WoL broadcast address |
| Wake         | `-p, --port <n>`           | `9`                  | WoL UDP port |
| SSH          | `-u, --user <user>`        | `ssh`'s resolution   | Falls back to `~/.ssh/config` `User`, then `$USER` |
| SSH          | `--ssh-port <n>`           | `22`                 | SSH port (use `2522` for WSL-direct sshd — see Gotcha #3) |
| SSH          | `-i, --identity <path>`    | `ssh`'s default      | Identity file |
| SSH          | `--ssh-opt <opt>`          | (repeatable)         | Pass-through `-o` option, e.g. `StrictHostKeyChecking=accept-new` |
| Remediation  | `-r, --remediate <cmd>`    | —                    | Command run on host after wake |
| Remediation  | `-V, --verify <cmd>`       | —                    | Health check (exit 0 = ok) |
| Remediation  | `-g, --grace <s>`          | `10`                 | Wait between SSH-up and remediate, **and** between remediate and verify |
| Mode (xor)   | `-f, --force`              | off                  | Run remediation even if already awake |
| Mode (xor)   | `--wake-only`              | off                  | Send packet, exit (no probe, no remediate) |
| Mode (xor)   | `--no-restart`             | off                  | Wake + wait for SSH, skip remediate |
| Mode (xor)   | `--no-wake`                | off                  | Skip wake; just probe + remediate (`--mac` becomes optional) |
| Mode (xor)   | `-n, --dry-run`            | off                  | Print plan, perform nothing, exit 0 |
| Polling      | `-t, --timeout <s>`        | `180`                | Total wake timeout |
| Polling      | `--poll <s>`               | `3`                  | SSH re-probe interval |
| Polling      | `--probe-timeout <s>`      | `2`                  | Initial probe `ConnectTimeout` |
| Output       | `-q, --quiet`              | off                  | Errors only |
| Output       | `-v, --verbose`            | off                  | Per-step + timings |
| Output       | `-d, --debug`              | off                  | Full SSH transcripts + resolved options |
| Output       | `--json`                   | off                  | Single JSON object to stdout; progress redirected to stderr |
| Standard     | `-h, --help` / `--version` |                      | Help / version |

The five mode flags (`--force`, `--wake-only`, `--no-restart`, `--no-wake`,
`--dry-run`) are mutually exclusive — combining any two exits `64`.

## Surface area — library exports

```javascript
// All exports from 'oi-wake-up' (= src/index.js):
wake(mac, { address?, port? }) -> Promise<void>     // defaults: '255.255.255.255', 9
createMagicPacket(mac)         -> Buffer            // exactly 102 bytes
parseMAC(mac)                  -> Buffer            // 6 bytes; throws on invalid
isValidMAC(mac)                -> boolean           // never throws
```

The verify orchestrator's internals (`parseVerifyArgs`, `decideAction`,
`probeSsh`, `pollUntilReachable`, `runRemote`, `sendWake`, `buildSshArgs`,
`createLogger`) live in `src/verify.js` but are **not** part of the published
import surface — `package.json` only exports `./src/index.js`. Treat them as
internal.

## State and loading semantics

- **Stateless.** Each invocation is independent. No cache, no session, no
  warm-up. Re-invoking is always safe.
- **Idempotent by default.** `oi-wake-verify` on an already-awake host is a
  no-op (exit 0). Use `--force` only when you actually need the remediation
  to re-run.
- **No retry on the wake packet itself.** `wake()` sends one UDP datagram
  and resolves. If you need redundancy against packet loss, send the same
  MAC multiple times with `-d` (e.g. `oi-wake-up -d 1000 MAC MAC MAC`).
- **Polling, not push.** `--poll` SSH every `--poll` seconds up to
  `--timeout`. The host must accept SSH `BatchMode=yes` connections (no
  password prompt); key auth is required.
- **Grace applies twice on the wake-and-remediate path** — once after SSH
  comes up, once after `--remediate` runs. Default `10` is sane only when
  your `--verify` command does its own readiness wait. Bump it otherwise.

## Identifiers — exact strings

### MAC address — three accepted formats

| Format    | Example             |
| --------- | ------------------- |
| Canonical | `01:02:03:04:05:06` |
| Windows   | `01-02-03-04-05-06` |
| Bare      | `010203040506`      |

Case-insensitive. Always 12 hex characters after delimiters are stripped.
Invalid input throws `Error('Invalid MAC address: <input>')` from `parseMAC`,
or returns `false` from `isValidMAC`.

### `oi-wake-verify` exit codes (stable contract — branch on these)

| Code  | Meaning                                                       |
| ----: | ------------------------------------------------------------- |
| `0`   | Success **or** already-awake (no action needed)               |
| `1`   | Misconfiguration (bad runtime state, internal error)          |
| `2`   | WoL send failed (UDP socket error)                            |
| `3`   | SSH never came up within `--timeout`                          |
| `4`   | `--remediate` command exited non-zero                         |
| `5`   | `--verify` command exited non-zero                            |
| `64`  | Invalid CLI usage (unknown flag, conflicting mode flags)      |
| `130` | Interrupted (SIGINT)                                          |

`oi-wake-up` uses only `0` (success) and `1` (any failure).

### `--json` output schema (oi-wake-verify)

A single JSON object on stdout (progress moves to stderr). Shape:

```json
{
  "host": "rtx3090",
  "state": "reachable" | "unreachable" | "dry-run" | null,
  "steps": [
    { "kind": "noop", "reason": "already awake — no action" },
    { "kind": "wake", "ok": true },
    { "kind": "wait", "ok": true, "attempts": 12, "totalMs": 47230 },
    { "kind": "grace", "seconds": 10 },
    { "kind": "remediate", "code": 0, "durationMs": 2300 },
    { "kind": "verify", "code": 0, "durationMs": 5800 }
  ],
  "exit": 0,
  "durationMs": 71450,
  "error": "..."        // present only when exit != 0
}
```

`steps` only contains the kinds the run actually executed.

## Critical gotchas

1. **Wrap remediation/verify commands in `bash -lc '…'`.** SSH non-interactive
   command execution uses the target's *login shell*. If the user's default
   shell is zsh and `just`/project binaries are on `PATH` only via
   `~/.bashrc`, your command will fail with `command not found`. `bash -lc
   'cd … && just restart'` forces a bash login shell with full PATH init.
   Safe even when the target shell is already bash.

2. **`-d` means different things in the two binaries.** In `oi-wake-up`,
   `-d` is `--delay` (ms between packets). In `oi-wake-verify`, `-d` is
   `--debug` (verbosity). They are different programs — don't paste flags
   between them.

3. **Prefer SSHing to WSL-side sshd over Windows OpenSSH.** On Windows + WSL
   targets, port `22` typically lands on Windows OpenSSH-Server, which
   parses your `--remediate` string with **PowerShell rules**, not bash.
   That breaks ordinary POSIX quoting, breaks `ssh-copy-id`, and forces
   `wsl.exe -d Ubuntu --` shimming with a separate
   `C:\ProgramData\ssh\administrators_authorized_keys` quirk. Configure the
   WSL distro to expose its own sshd on a different port (commonly `2522`)
   and target that with `--ssh-port 2522` (or set `Port 2522` in
   `~/.ssh/config` and use the host alias).

4. **Pick a `--verify` command that exercises the actual failing layer.**
   `nvidia-smi`-style "is the device visible" checks are misleading: they
   exit `0` even when CUDA passthrough is broken and the workload silently
   fell back to CPU at 5–30× the latency. Prefer a small timed inference
   call (e.g. a `just warmup` recipe that gates on `cold_ms`/`hot_ms`
   thresholds) so verify fails when a real workload would.

5. **The default broadcast `255.255.255.255` is unreliable in many
   networks.** Use the actual subnet broadcast (`-i 192.168.1.255` /
   `--broadcast 192.168.1.255`) when sending across switches, after long
   idle periods, or to NICs that drop their ARP entry on shutdown. Subnet
   broadcast bypasses ARP entirely and is the most reliable form.

6. **`wake-only` and `no-wake` change which flags are required.**
   `--no-wake` makes `--mac` optional (since no packet is sent).
   `--wake-only` still requires `--mac`. `--dry-run` validates flags but
   skips the probe and all I/O. Conflicting mode flags exit `64`.

7. **SSH probe uses `BatchMode=yes` — password prompts cannot work.**
   Key-based auth must already be set up. A failing probe currently surfaces
   only at `-d` (debug); at default verbosity an auth failure looks
   identical to "host asleep". If you need to disambiguate before the v1.2
   stderr-surfacing fix lands, retry once with `-d` and read the probe's
   stderr line.

8. **`--grace` applies twice on the wake path, once on the `--no-wake` /
   `--force` path.** Plan accordingly when scripting timeouts: the
   wake-and-remediate path can take up to roughly `probe-timeout +
   timeout + grace + remediate-runtime + grace + verify-runtime` seconds
   end-to-end. The default total ceiling is around `2 + 180 + 10 +
   remediate + 10 + verify` ≈ ~3.5 minutes plus your own commands.

9. **Some Realtek NICs only respond to magic packets for a few minutes
   after shutdown.** The router's ARP entry expires (1–5 min) and unicast
   packets stop reaching the NIC. Always send to the subnet broadcast,
   and/or set a static ARP entry on the router.

10. **`ErP Ready` / `Deep Sleep` BIOS settings silently kill WoL.** They
    cut standby power to the NIC. If the consumer is wiring a new target
    machine into automation, surface this to the human operator — no
    amount of correct CLI usage works around a hardware-disabled NIC.

## Working examples (shell)

### 1. Fire-and-forget wake (most common, lowest cost)

```bash
oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF
# stdout: "Magic packet sent to AA:BB:CC:DD:EE:FF"
# exit: 0
```

### 2. Wake + verify the GPU path on an RTX 3090 box

```bash
oi-wake-verify rtx3090 \
    --mac AA:BB:CC:DD:EE:FF \
    --remediate "bash -lc 'cd ~/repos/llmster-server-3090 && just restart'" \
    --verify   "bash -lc 'cd /home/winadmin/repos/llmster-server-3090 && just warmup'" \
    --grace 10 \
    -v
# Exits 0 if asleep→woken→remediated→verified, OR if already awake.
# Exits 3 / 4 / 5 on the corresponding failure.
```

### 3. Force restart on a known-awake host (skip the wake)

```bash
oi-wake-verify rtx3090 \
    --mac AA:BB:CC:DD:EE:FF \
    --force \
    --remediate "bash -lc 'cd ~/repos/llmster-server-3090 && just restart'" \
    --verify   "bash -lc 'cd /home/winadmin/repos/llmster-server-3090 && just warmup'"
```

### 4. Machine-readable run — for parsing in another agent

```bash
oi-wake-verify rtx3090 \
    --mac AA:BB:CC:DD:EE:FF \
    --remediate "..." \
    --verify "..." \
    --json | jq '{exit, state, durationMs, steps: [.steps[].kind]}'
```

### 5. Health-check / liveness probe (no wake, no remediation)

```bash
oi-wake-verify rtx3090 --no-wake --probe-timeout 3 -q
# exit 0 = SSH reachable; exit 3 = unreachable; exit 64 = bad flags.
```

### 6. Library use (Node, when shelling out is undesirable)

```javascript
import { wake, isValidMAC } from 'oi-wake-up';

const mac = 'AA:BB:CC:DD:EE:FF';
if (!isValidMAC(mac)) throw new Error(`bad MAC: ${mac}`);

await wake(mac, { address: '192.168.1.255', port: 9 });
// resolves once the UDP datagram has been handed to the OS.
// no response is expected — WoL has no return channel.
```

## Recommended defaults

| For…                                | Use                                 | Because |
| ----------------------------------- | ----------------------------------- | ------- |
| First-try wake on most LANs         | `-i <subnet-broadcast>`             | Subnet broadcast bypasses ARP, works after the router's ARP entry expires |
| Calling from a script / automation  | `--quiet --json`                    | Single parseable line on stdout, no progress noise |
| Idempotent wake-and-fix loops       | `oi-wake-verify` (no `--force`)     | No-op on already-awake hosts; safe to re-run on a timer |
| Targets behind WSL                  | `--ssh-port 2522` (or alias)        | Avoids PowerShell-quoting trap on Windows OpenSSH |
| Targets where remediation uses `just` / `direnv` | `bash -lc '…'` wrapper  | Forces login-shell PATH init |
| Long-running remediation            | bump `--grace` to ≥ readiness time  | Default `10` assumes verify has its own readiness wait |
| Redundancy against UDP packet loss  | `oi-wake-up -d 1000 MAC MAC MAC`    | Three packets, 1s apart; cheap insurance, no return-channel to confirm |

## Operational signals

| What you observe                                                          | Likely cause                                              | What to do |
| ------------------------------------------------------------------------- | --------------------------------------------------------- | ---------- |
| `oi-wake-up` exits 0 but host never wakes                                 | NIC has no standby power (ErP Ready, Deep Sleep, Fast Startup, or a Realtek S5 setting) | Escalate to operator — needs BIOS / Windows config change. See `README.md` "Prerequisites" |
| `oi-wake-up` exits 0 but only works within ~3 min of shutdown             | Router ARP entry expired; NIC stopped responding to unicast | Switch to subnet broadcast (`-i 192.168.1.255`) or set static ARP on the router |
| `oi-wake-verify` exits `3` (SSH timeout)                                  | Host woke but sshd not yet listening, OR host never woke, OR auth misconfigured | Retry once with `-d` to inspect probe stderr; widen `--timeout`; verify key auth from this machine manually |
| `oi-wake-verify` exits `4` (remediation failed)                           | Remote command non-zero — most often `command not found` from non-login shell | Wrap in `bash -lc '…'` (Gotcha #1); inspect with `-d` |
| `oi-wake-verify` exits `5` (verify failed) on a host that "looks fine"    | Verify command runs before services are ready             | Bump `--grace`; or move readiness wait inside the verify recipe |
| `oi-wake-verify` exits `5` but `nvidia-smi`/`docker ps` look healthy      | Verify is testing the wrong layer (Gotcha #4)             | Switch to a timed inference / latency-gated recipe |
| `oi-wake-verify` exits `64`                                               | Unknown flag or two mode flags combined                   | Read stderr; only one of `--force / --wake-only / --no-restart / --no-wake / --dry-run` allowed |
| `oi-wake-verify` exits `130`                                              | Caller (or shell) sent SIGINT mid-poll                    | Re-invoke; all steps are idempotent |
| `Warning: Invalid MAC address: …` on stderr from `oi-wake-up`             | One of several MACs was malformed                         | Run still proceeds for valid MACs; fix the bad one |
| Hangs at "Waiting for SSH…" with no progress                              | `--poll`/`--timeout` set too generously, or no SSH key in agent | Add `-v` to see per-attempt codes; check `ssh -o BatchMode=yes <host> true` manually |

## Closing notes

- **Versioning.** Current shipped version: `1.1.0` (covers both binaries).
  Exit codes, the `--json` step kinds, and the library exports are documented
  as a stable contract — breaking changes bump the major.
- **Living doc.** Flags and exit codes here are a snapshot of current source.
  Authoritative runtime references are `oi-wake-up --help` and
  `oi-wake-verify --help` — prefer those in long-running automation.
- **No npm registry.** Install only via
  `pnpm add -g github:CaptainCodeAU/oi-wake-up` (or `pnpm link --global` in a
  clone). `npm install oi-wake-up` does not exist.
