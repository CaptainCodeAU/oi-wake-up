# Roadmap

Last updated: 2026-05-03 (post re-architecture)

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
- ✓ Global install via `pnpm link --global`

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

## In progress

*(nothing currently in flight)*

---

## Planned

### v1.2.0 — observability and ergonomics polish (candidates, none scheduled)

These surfaced during v1.1 real-world testing on the 3090. Each is independently shippable; none are required for v1.1's primary use case. Listed in suggested ship order — items with implicit dependencies are noted inline.

- ☐ **Surface probe stderr at default verbosity on probe failure** — *(do this one first)*. Current behavior buries the actual failure reason at `-d`. Host-key errors, connection timeouts, auth failures, and sshd-down each have different fix paths; users shouldn't need debug mode to find out which. General-purpose fix that catches host-key failures *and* anything else weird that surfaces in the future. The SSH-territory agent specifically called this out as their preferred primary fix because it doesn't paper over future failure classes the way an `--accept-new-host` shortcut would.
- ☐ **`--capture-verify` flag** — include verify command's stdout in the JSON output regardless of verbosity, so automation can extract proof artifacts (e.g. the `cold_ms=N hot_ms=N threshold_ms=N` line from `just warmup`) without scraping `-d` output. Strongest case of the polish bunch — concrete automation need surfaced multiple times during testing and reinforced by the 3090-side agent's parseable output design.
- ☐ **`--accept-new-host` convenience flag** — *(ship only after probe stderr is surfaced at default verbosity)*. Wraps `--ssh-opt StrictHostKeyChecking=accept-new`. First-run ergonomic improvement; users currently need the verbose pass-through form. **Don't ship this in isolation** — silently auto-accepting host keys that the user can't see (because probe stderr is still buried at `-d`) would be worse than the current footgun. The two flags work together: surface stderr so users see *why* probe failed, then offer the convenience flag as the explicit fix.
- ☐ **`--forward-agent` flag** — pass `-A` to spawned ssh invocations for verify or remediate commands that need agent forwarding back to the originating host. Lower priority — no current consumer; worth implementing when one materialises.
- ☐ **ICMP-pre-probe + SSH-probe two-stage liveness** — distinguish "host asleep / off network" from "host reachable but SSH probe failed". Largest design surface; do last, or write a fresh plan in `Plans/` before implementing.

See `IDEAS.md` for the unstarted-ideas inbox; promote items here when scheduled.

---

## Out of scope / parked

- ⊘ **Publishing to npm registry** — use `pnpm add -g github:CaptainCodeAU/oi-wake-up` instead. See `DECISIONS.md` #4.
- ⊘ **Configuration file support** (JSON/YAML/TOML) — args + shell aliases are canonical. See `DECISIONS.md` #5.
- ⊘ **Multi-target orchestration / `--all` mode** — YAGNI until 3+ targets needed.
- ⊘ **Notification integration** (Pushover / ntfy / Slack) — better as a post-hook than baked in.
- ⊘ **Daemon / scheduler-aware mode** — separate tool's job.
- ⊘ **Auto-detect MAC from ARP cache** — see `IDEAS.md` for current thinking.
