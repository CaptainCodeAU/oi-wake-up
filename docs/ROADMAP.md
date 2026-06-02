# Roadmap

Last updated: 2026-06-02 (v1.4.0 — remediate/verify SSH hardening: ConnectTimeout + ServerAlive + cmd timeouts + SIGTERM journal flush)

## Status legend
- ✓ Done
- 🟡 In progress
- ☐ Planned
- ⊘ Out of scope / parked

---

## Released

### v1.0.0 — Initial release (2026-04-02)
- ✓ Core WoL library: `parseMAC`, `isValidMAC`, `createMagicPacket`, `wake`
- ✓ CLI binary `oi-wake-up` with full flag set (`-i`, `-p`, `-q`, `-f`, `-d`, `-v`, `-h`)
- ✓ Tests via `node:test` + `node:assert/strict`
- ✓ README with comprehensive WoL prerequisites + troubleshooting (per-vendor BIOS settings, Realtek NIC quirks, time-limited wake windows, ARP behaviour)
- ✓ MIT license
- ✓ direnv integration (`.envrc` with project info box)
- ✓ Global install via `pnpm install -g .`

### Documentation reorganisation (completed 2026-05-02)
- ✓ Move `docs/CLAUDE.md` → `CLAUDE.md` (root) — auto-loads on every session
- ✓ Delete `docs/SPEC.md` (60% obsolete, rest covered by README)
- ✓ Update README install section (GitHub-direct install + zero-dep risk note)
- ✓ Create `docs/ROADMAP.md` (this file)
- ✓ Create `docs/DECISIONS.md` (7 seed entries)
- ✓ Create `docs/METAPROMPT.md` (3 saved prompts)
- ✓ Create `docs/IDEAS.md` (4 seed bullets)
- ✓ Create `docs/GLOSSARY.md` (~10 WoL terms)
- ✓ Cross-link `Plans/` → `METAPROMPT.md` sections (footer in oi-wake-verify plan)

Committed as `9b5e24b`. Plan: `Plans/docs-reorg.md` (gitignored).

### v1.1.0 — `oi-wake-verify` (second binary, shipped 2026-05-02)
- ✓ New CLI: wake → SSH probe → remediation → verify, in one idempotent command
- ✓ Composes existing `wake` and `isValidMAC` from `src/index.js` (zero new runtime deps)
- ✓ Args-only personalisation; no config file
- ✓ Stable exit codes (0 / 1 / 2 / 3 / 4 / 5 / 64 / 130) per the design plan
- ✓ Verbosity tiers: quiet / default / verbose / debug + `--json`
- ✓ All five state-machine cells exercised end-to-end against the RTX 3090 (live `cold_ms=5974 hot_ms=114 threshold_ms=3000` from `just warmup` after a full sleep cycle)
- ✓ 57/57 unit tests passing including the spawn-fake Layer-2 integration suite

Surfaces created/modified: `bin/verify.js`, `src/verify.js`, `src/spawn.js`, `tests/verify.test.js`, `tests/spawn-fake.js`, plus README + DECISIONS + CLAUDE.md updates.

Drives: post-resume CUDA passthrough fix on the RTX 3090 LLM rig.  
Plan (historical): `Plans/i-have-completely-banned-wild-quilt.md`  
Execution view (historical): `Plans/you-re-picking-up-an-glimmering-hearth.md`

Two real bugs found and fixed during real-world testing — see `DECISIONS.md` #11 (post-remediate grace) and #12 (no `$USER` auto-default). Both have unit-test coverage.

### v1.2.0 — incremental re-architecture (2026-05-03)

Incremental improvement pass across the full codebase. No breaking changes. 78/78 tests.

**Testability**
- ✓ `wake()` made `async`; accepts optional `deps.createSocket` — mirrors the `spawnSsh` DI pattern. Every I/O edge now has a fake.
- ✓ `tests/dgram-fake.js` added — recording fake socket factory for `wake()` / `wakeMany()` tests
- ✓ `tests/spawn-fake.js` — fast-path now honours `opts.signal`; `throw` field documented; `killed` field returned

**Library API**
- ✓ `wakeMany(targets, opts, deps)` — sends N magic packets over a single UDP socket with optional inter-packet delay; replaces the N-socket loop in `bin/cli.js`
- ✓ `executePlan`, `VerifyError`, `EXIT` exported from `src/verify.js`; library consumers can now import the full orchestrator pipeline
- ✓ Subpath exports added: `oi-wake-up/verify` and `oi-wake-up/spawn`

**New CLI flags**
- ✓ `oi-wake-up --print-packet` — print 102-byte hex dump; do not send
- ✓ `oi-wake-verify --journal <path>` — append JSON journal entry to a JSONL file on every run
- ✓ `oi-wake-verify --retry-wake <n>` — re-send magic packet if SSH times out; retry up to N times
- ✓ `oi-wake-verify --max-output <bytes>` — cap captured stdout+stderr; default 1 MiB

**Robustness**
- ✓ `spawnSsh` — `maxBuffer` option (default 1 MiB) with `[output truncated]` marker; `sshBin` option for future alternate SSH binaries
- ✓ `makeOpts(overrides)` test helper in `verify.test.js` — prevents test drift when parser defaults change

Plan: `Plans/if-we-were-to-crispy-axolotl.md`

---

### v1.3.0 — `oi-wake-down` (third binary, 2026-05-04)

Third binary completing the wake/sleep symmetry. SSH into the host, trigger Windows sleep via WSL→Windows interop (`rundll32 SetSuspendState`), confirm the host went unreachable. Idempotent — no-op if already asleep.

- ✓ New CLI `oi-wake-down <host>` — sleep counterpart to `oi-wake-verify`
- ✓ Default sleep command: `/mnt/c/Windows/System32/rundll32.exe powrprof.dll,SetSuspendState 0,1,0` (Windows via WSL; `--command` override for Linux/macOS)
- ✓ Idempotent pre-flight probe (already asleep → exit 0, no action)
- ✓ `--confirm-asleep` (default ON) — polls SSH until host becomes unreachable
- ✓ `--no-confirm` — fire-and-forget, exit after sending
- ✓ Connection-drop handling — exit 255 with connection-closed stderr treated as successful delivery (host may sleep before rundll32 returns)
- ✓ Full diagnostic parity: `--dry-run`, `--json`, `--journal`, `-v`, `-d`, `-q`
- ✓ Stable exit codes: 0 OK, 1 MISCONFIG, 6 SLEEP_FAILED, 7 SLEEP_NOT_CONFIRMED, 64 USAGE, 130 INTERRUPTED
- ✓ `src/sleep.js` — parser, state-machine, executor, re-exports shared utils from `src/verify.js`
- ✓ `oi-wake-up/sleep` subpath export added to `package.json`
- ✓ 110/110 tests (78 existing + 32 new sleep tests)

Plan: `Plans/on-that-note-is-humble-music.md`

---

### Documentation: re-sleep troubleshooting (2026-06-02)

Surfaced during operational use of `oi-wake-verify` against the RTX 3090 box: a WoL-woken host became unreachable ~2 minutes after each wake. Diagnosed (via Windows event log + `powercfg`) as the **System unattended sleep timeout** (`UNATTENDSLP`, default 120s) returning the host to S3 sleep after an unattended wake — not a shutdown, not a failed wake. No repo behaviour changed; docs only.

- ✓ README — new Troubleshooting subsection "Machine wakes, then goes back to sleep ~2 minutes later" + a Common-blockers row, with the `powercfg` fix and how to confirm via Event ID 42/1
- ✓ GLOSSARY — added "System unattended sleep timeout (UNATTENDSLP)" and "Hybrid Sleep (Windows)"
- ✓ DECISIONS #19 — keeping a woken host awake is host power-policy config (documented), not the tool's job
- ✓ USAGE + AGENT_BRIEF — re-sleep caveat added to the wake examples / gotchas
- ✓ 110/110 tests still green (no code touched)

---

### v1.4.0 — remediate/verify SSH hardening (2026-06-02)

Surfaced by a sister project (Proxmox CT150 dispatcher) wrapping `oi-wake-verify` to gate GPU access on the 3090 box: the full `--remediate "just restart" --verify "just warmup"` invocation hung for exactly 120s and was `SIGTERM`-killed by the dispatcher's `execFile` cap (surfacing as `code:1`, not an oi-wake-verify exit). A three-agent investigation (oi-wake-up + 3090-side + CT150) traced it to a transient post-wake window where the CT150→mlbox TCP connect never reached sshd; `runRemote` had no `ConnectTimeout`, so it rode OpenSSH's ~120s default. See DECISIONS #20.

- ✓ `runRemote` now carries `ConnectTimeout=10` + `ServerAliveInterval=5`/`ServerAliveCountMax=3` on the remediate/verify channels — opt-in per call, so the probe and `oi-wake-down`'s sleep channel are unchanged
- ✓ `--remediate-timeout <s>` / `--verify-timeout <s>` — kill a hung command (`SIGKILL`) and fail cleanly with exit 4/5 (`… timed out after Ns`); default `0` = no cap (backward-compatible)
- ✓ `oi-wake-verify` now traps `SIGTERM` + `SIGHUP` (not just `SIGINT`) — flushes the `--json`/`--journal` record before exit, so a parent timeout no longer leaves an empty journal with no trace of the stalled step (handler mirrored to `oi-wake-down` for parity)
- ✓ Surface probe stderr at default verbosity on probe failure — completes the Planned candidate below
- ✓ 125/125 tests (110 existing + 9 new unit + 6 new in `tests/spawn.test.js` [real `spawnSsh`: timeout-kill, maxBuffer, abort] & `tests/signals.test.js` [SIGTERM journal-flush, subprocess]); verified live (ConnectTimeout bounds a black-hole connect to ~10s; SIGTERM writes the journal)

Surfaces modified: `src/verify.js`, `bin/verify.js`, `bin/sleep.js` (SIGTERM/SIGHUP parity), `tests/verify.test.js`, `tests/spawn.test.js` (new), `tests/signals.test.js` (new), plus README + DECISIONS. `src/spawn.js` already supported `timeoutMs` (v1.2.0) — no change needed.

---

## In progress

*(nothing currently in flight)*

---

## Planned

### Candidates (none scheduled)

These surfaced during v1.1 real-world testing on the 3090. Each is independently shippable; none are required for v1.1's primary use case. Listed in suggested ship order — items with implicit dependencies are noted inline.

- ✓ **Surface probe stderr at default verbosity on probe failure** — *shipped in the 2026-06-02 hardening pass above.* Current behavior buried the actual failure reason at `-d`. Host-key errors, connection timeouts, auth failures, and sshd-down each have different fix paths; users shouldn't need debug mode to find out which. General-purpose fix that catches host-key failures *and* anything else weird that surfaces in the future. The SSH-territory agent specifically called this out as their preferred primary fix because it doesn't paper over future failure classes the way an `--accept-new-host` shortcut would.
- ☐ **`--capture-verify` flag** — include verify command's stdout in the JSON output regardless of verbosity, so automation can extract proof artifacts (e.g. the `cold_ms=N hot_ms=N threshold_ms=N` line from `just warmup`) without scraping `-d` output. Strongest case of the polish bunch — concrete automation need surfaced multiple times during testing and reinforced by the 3090-side agent's parseable output design.
- ☐ **`--accept-new-host` convenience flag** — *(ship only after probe stderr is surfaced at default verbosity)*. Wraps `--ssh-opt StrictHostKeyChecking=accept-new`. First-run ergonomic improvement; users currently need the verbose pass-through form. **Don't ship this in isolation** — silently auto-accepting host keys that the user can't see (because probe stderr is still buried at `-d`) would be worse than the current footgun. The two flags work together: surface stderr so users see *why* probe failed, then offer the convenience flag as the explicit fix.
- ☐ **`--forward-agent` flag** — pass `-A` to spawned ssh invocations for verify or remediate commands that need agent forwarding back to the originating host. Lower priority — no current consumer; worth implementing when one materialises.
- ☐ **ICMP-pre-probe + SSH-probe two-stage liveness** — distinguish "host asleep / off network" from "host reachable but SSH probe failed". Largest design surface; do last, or write a fresh plan in `Plans/` before implementing.
- ☐ **`oi-wake-verify` UNATTENDSLP preflight warning** — after a successful wake, read the target's Windows "System unattended sleep timeout" over SSH and warn when the host will auto-return-to-sleep in ~N seconds unless kept awake. Surfaced 2026-06-02 when the 3090 box silently re-slept ~120s after each unattended WoL wake (Windows default). Read-only diagnostic that only *warns* (never changes host power policy — DECISIONS #19); gate behind a flag since it adds an SSH round-trip. See `IDEAS.md`.

See `IDEAS.md` for the unstarted-ideas inbox; promote items here when scheduled.

---

## Out of scope / parked

- ⊘ **Publishing to npm registry** — install via `pnpm install -g .` from a local clone. See `DECISIONS.md` #4.
- ⊘ **Configuration file support** (JSON/YAML/TOML) — args + shell aliases are canonical. See `DECISIONS.md` #5.
- ⊘ **Multi-target orchestration / `--all` mode** — YAGNI until 3+ targets needed.
- ⊘ **Notification integration** (Pushover / ntfy / Slack) — better as a post-hook than baked in.
- ⊘ **Daemon / scheduler-aware mode** — separate tool's job.
- ⊘ **Auto-detect MAC from ARP cache** — see `IDEAS.md` for current thinking.
