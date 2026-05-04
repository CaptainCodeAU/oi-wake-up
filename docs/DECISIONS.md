# Design Decisions

Append-only log of design decisions and their rationale. New entries at the bottom. Mark superseded entries with `Status: Superseded by #N` rather than deleting them.

---

## 1. Zero runtime dependencies
**Date:** 2026-04-02  
**Decision:** Use only Node.js built-in modules. No external runtime dependencies, ever.  
**Why:** Wake-on-LAN is a small, well-defined protocol; a ~100-line implementation using `node:dgram` is more reliable than wrapping an npm package. Eliminates supply-chain risk, version-conflict pain, and audit surface. Makes global install trivially safe.  
**Alternatives considered:** None seriously — the constraint was set at project inception.  
**Status:** Active.

---

## 2. ESM throughout
**Date:** 2026-04-02  
**Decision:** Use ECMAScript modules (`"type": "module"` in `package.json`); no CommonJS.  
**Why:** Node 18+ has stable ESM support; the project targets `>=18.0.0`. Simpler import semantics, no `require` weirdness, future-proof.  
**Alternatives considered:** Dual-publishing CJS + ESM — rejected as over-engineering for a tiny zero-dep tool.  
**Status:** Active.

---

## 3. pnpm only — npm banned
**Date:** 2026-04-02 (initial), reaffirmed 2026-05-01.  
**Decision:** pnpm is the only supported package manager. npm is banned in commands, docs, and suggestions. bun is acceptable as an alternative.  
**Why:** Personal preference, framed as "completely banned" in the 2026-05-01 design conversation. `package.json` pins `pnpm@10.30.3`. A single canonical package manager keeps install instructions consistent and avoids npm's quirks.  
**Alternatives considered:** Allowing npm as a fallback — rejected for clarity and consistency.  
**Status:** Active.

---

## 4. Not publishing to npm registry
**Date:** 2026-04-02 (commit `31ba24b`).  
**Decision:** This project ships via GitHub-direct install (`pnpm add -g github:CaptainCodeAU/oi-wake-up`), not via the npm registry.  
**Why:** Avoids registry-publishing overhead (versioning ceremony, owning the package name) for a tool that's primarily personal-use but happens to be public. Zero-dep status makes the GitHub install pattern fully equivalent in user experience.  
**Alternatives considered:** Publishing to npm — explicitly rejected. The commit message: *"Not publishing to npmjs — install section now shows git clone + pnpm install + pnpm link --global workflow."*  
**Status:** Active.

---

## 5. Args + shell aliases over config files (for personal-use CLIs)
**Date:** 2026-05-01.  
**Decision:** Personalisation goes through CLI flags + shell aliases, not a JSON/YAML/TOML config file.  
**Why:** The user's existing `wakeup` alias pattern (`oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF`) proves the model works. Aliases live in `~/.zshrc` (or `~/.ssh/config` for SSH-related values) where they belong; a config file would duplicate functionality. Public-repo users copy example aliases from the README.  
**Alternatives considered:** JSON config with multi-target schema, precedence chain, `--list-targets` — proposed and explicitly rejected. Reconsider only if 3+ first-class targets emerge or schema needs become real.  
**Status:** Active.

---

## 6. Two binaries in same repo
**Date:** 2026-05-01.  
**Decision:** The planned `oi-wake-verify` ships as a second `bin` entry in this same repo, not as a separate package.  
**Why:** Composes naturally on top of the existing `oi-wake-up` library. New users clone once and get both tools. Symmetric to npm-ecosystem norms (e.g. `vite` + `vite-node`).  
**Alternatives considered:** Separate repo with `oi-wake-up` as a `github:` dependency — rejected as overhead. Examples folder with a recipe script — rejected for poor discoverability.  
**Status:** Active. Implementation tracked in `Plans/i-have-completely-banned-wild-quilt.md`.

---

## 7. WSL-direct SSH (port 2522) over Windows-OpenSSH + `wsl.exe` shim
**Date:** 2026-05-02.  
**Decision:** For remediation commands targeting the RTX 3090 (`mymachine`), use SSH directly to the WSL Ubuntu sshd on port 2522, not via Windows OpenSSH (port 22) + `wsl.exe`.  
**Why:** Windows OpenSSH defaults to PowerShell as the remote shell, which (a) parses commands with PowerShell quoting rules instead of bash, (b) breaks `ssh-copy-id` (POSIX shell snippets fail), (c) has the Windows-Admin-keys quirk (`C:\ProgramData\ssh\administrators_authorized_keys`). The WSL-direct path lands in bash, sidesteps all three issues, and is the only path with key auth currently set up.  
**Alternatives considered:** Windows-port-22 with `wsl.exe -d Ubuntu --` shim — works but requires PowerShell-friendly quoting and the Windows admin-keys workaround. Documented as fallback only.  
**Status:** Active.

---

## 8. Single `spawnSsh` helper as testable boundary
**Date:** 2026-05-02.  
**Decision:** Every `ssh` subprocess call routes through `spawnSsh(args, opts)` in `src/spawn.js`. The orchestrator (`probeSsh`, `pollUntilReachable`, `runRemote`) accepts an injected `spawn` dependency that defaults to this helper.  
**Why:** Layer 2 tests need to exercise the real orchestrator code path without spawning real ssh processes. Pinning the spawn boundary to one function (~30 lines) means tests swap in `tests/spawn-fake.js` (a recording fake) at one place and exercise every state-machine transition, every documented exit code, and every verbosity tier in <1s with no network. Per the testing pyramid in the design plan, this layer catches ~95% of bugs at much lower cost than a containerised SSH harness.  
**Alternatives considered:** Mocking at the `node:child_process` module level (heavier, leakier between tests); skipping orchestrator unit-tests and relying on Layer 3 localhost-SSH tests only (slower, environment-dependent, doesn't run in CI without sshd).  
**Status:** Active.

---

## 9. `--dry-run` skips the SSH probe
**Date:** 2026-05-02.  
**Decision:** `--dry-run` does not perform the pre-flight SSH probe. Instead it prints both possible action plans (reachable: noop; unreachable: full wake → wait → grace → remediate → verify chain) and exits 0.  
**Why:** A probe is itself an action — it spawns `ssh`, opens a TCP connection, attempts auth, takes the documented `--probe-timeout` seconds. "Print planned actions; perform none" cannot do that and stay honest. Printing both branches is more useful than committing to one based on a network round-trip the user explicitly asked us to skip.  
**Alternatives considered:** Probe-then-print (rejected: violates "perform none"); print only the unreachable branch (rejected: less informative — users frequently dry-run to sanity-check the alias against an awake host).  
**Status:** Active.

---

## 10. Logger redirects progress to stderr in `--json` mode
**Date:** 2026-05-02.  
**Decision:** With `--json` set, the structured JSON object is the *only* thing written to stdout. Step / info / verbose / debug messages still emit, but to stderr, where they continue to respect the verbosity tier.  
**Why:** Callers piping `oi-wake-verify --json | jq ...` need a clean machine-parseable stream. But verbose/debug progress is still useful for humans watching alongside, so it doesn't make sense to suppress it entirely — stderr is the conventional "humans-only" channel. This is the same convention `curl`, `git`, etc. use for diagnostic output during machine-readable operations.  
**Alternatives considered:** Suppress all progress in `--json` mode (rejected: loses observability); emit JSON-line progress events (rejected: turns one-shot tool into streaming protocol, larger blast radius).  
**Status:** Active.

---

## 11. Grace step inserted between `remediate` and `verify`
**Date:** 2026-05-02 (post real-world testing).  
**Decision:** When a plan contains both `remediate` and `verify`, a `grace` step is inserted between them. On the asleep-default/force path the plan is now `[wake, wait, grace, remediate, grace, verify]` — `grace` appears twice. On reachable+force/noWake it's `[remediate, grace, verify]`. The grace step's label is "Grace Ns to settle" (position-agnostic), not "before remediation" (which it used to be when it only appeared in one spot).  
**Why:** Real-world testing against the 3090 surfaced that the post-restart settle period needs explicit time — `just warmup` immediately after `docker compose restart` failed with `warmup_cold_failed=1` because the model wasn't loaded for completions yet (the recipe's `/v1/models` wait loop returns success too early). The original design only graced after `wait` (post-SSH-up), implicitly assuming `remediate` ran fast and `verify` could fire immediately. That's wrong for any remediate that restarts a service. Same "wait for state to settle" problem at a different transition.  
**Alternatives considered:**
- Separate `--remediate-settle` flag with its own value (rejected: adds a flag for what the existing `--grace` value covers fine; users who want zero settle-time can pass `--grace 0`).
- Make grace conditional on `--remediate` having been provided (rejected: needs more state-machine logic for marginal benefit; the grace step is already a no-op when `opts.grace === 0`).
- Bake the grace into the verify command itself (rejected: pushes timing concerns into every user's verify string; doesn't compose well; obscures what the tool is doing).

The plan-spec change is one line in `decideAction`. The user-facing semantic shift: `--grace` now means "settle time after any state-changing transition", not "settle time before remediation". The README's `--grace` paragraph explicitly notes this.  
**Status:** Active. **Update 2026-05-02 (PM):** The 3090-side `just warmup` recipe was made self-sufficient (commit `127df36` in the llmster-server-3090 repo), so callers no longer need `--grace 25` for the GPU-rebind workflow — the recipe handles its own readiness wait. The README example was rolled back to default `--grace 10`. The architectural decision (grace between remediate and verify on every relevant plan) still stands as insurance for verify commands that aren't self-sufficient.

---

## 13. `wake()` is async with an injectable socket factory
**Date:** 2026-05-03.  
**Decision:** `wake(mac, options, deps)` accepts an optional `deps.createSocket` parameter. When not provided, it falls back to `dgram.createSocket.bind(dgram)`. The function is declared `async` so sync throws (e.g. bad MAC) become rejections rather than escaping the promise chain.  
**Why:** Mirrors the `spawnSsh` DI pattern from Decision #8. Before this change, `wake()` was the only I/O edge in the project with no test seam — the `dgram` call was untestable without a real network. The `dgram-fake.js` recording fake now exercises `wake()` and `wakeMany()` at the same depth as `spawn-fake.js` covers SSH. Making the function `async` is also the correct API contract — an async function should never throw synchronously.  
**Alternatives considered:** Keeping `wake` sync and using module-level mocking (rejected: leaky between tests, heavier DI point); keeping `wake` sync and testing only via real UDP (rejected: slower, requires a listening socket).  
**Status:** Active.

---

## 14. `executePlan`, `VerifyError`, `EXIT` exported from `src/verify.js`
**Date:** 2026-05-03.  
**Decision:** `executePlan`, `VerifyError`, and the `EXIT` code map moved from `bin/verify.js` (private) to `src/verify.js` (exported). `executePlan` accepts a `deps` object (`spawn`, `wake`, `sleep`) so every I/O call within it is injectable. `bin/verify.js` shrinks to: parse → execute → flush journal.  
**Why:** The orchestrator is now a reusable library primitive, not just a CLI implementation detail. Callers can `import { executePlan, decideAction } from 'oi-wake-up/verify'` and compose their own wake pipeline. The `EXIT` codes are part of the stable documented contract (README); exporting them makes that contract consumable programmatically. Moving `executePlan` to the source module also opens it to unit-testing without spawning the CLI binary.  
**Alternatives considered:** Keep `executePlan` private and only expose `decideAction` + individual step primitives (rejected: forces library consumers to reimplement the dispatcher); keep `EXIT` only in the binary (rejected: breaks programmatic use of exit codes).  
**Status:** Active.

---

## 15. `wakeMany()` as the primary multi-target primitive
**Date:** 2026-05-03.  
**Decision:** Add `wakeMany(targets, opts, deps)` to `src/index.js` that sends N magic packets over a single UDP socket. `bin/cli.js` was refactored to use it instead of looping `wake()`. Per-target `address` and `port` overrides are supported; an optional `delay` between packets is supported.  
**Why:** The original multi-MAC loop in `bin/cli.js` opened and closed a fresh UDP socket for each MAC. For 2–3 targets this is harmless, but the model is wrong — a single socket can `send` to multiple destinations. Extracting `wakeMany` also keeps the CLI thin and makes batch-wake testable via `dgram-fake` without duplicating the socket-management logic.  
**Alternatives considered:** Expose a `socket` object from `wake()` and let callers reuse it (rejected: leaks resource management to the caller); make `wake()` accept an array (rejected: conflates single and batch semantics in one function signature).  
**Status:** Active.

---

## 16. `spawnSsh` output bounded by `maxBuffer` with a truncation marker
**Date:** 2026-05-03.  
**Decision:** `spawnSsh` accumulates stdout + stderr into a shared byte counter. When the combined total exceeds `maxBuffer` (default 1 MiB), further chunks are dropped and a `\n[output truncated]` marker is appended to whichever stream crossed the limit. The `oi-wake-verify --max-output <bytes>` flag surfaces `maxBuffer` to the CLI.  
**Why:** A `--remediate` or `--verify` command that produces large output (e.g. a test suite, a build step, `yes`) would balloon memory unboundedly with the original unbounded string concat. The 1 MiB default is generous enough to capture any normal command output while protecting against runaway processes. The truncation marker makes it obvious in logs that output was cut.  
**Alternatives considered:** `child_process.spawn` `maxBuffer` option (not available on the streaming API we use, only on `execFile`); silently truncating without a marker (rejected: confusing in logs); rejecting the promise when the limit is hit (rejected: kills the remediation for a non-fatal condition).  
**Status:** Active.

---

## 17. `--retry-wake` implemented in the `wait` step, not in `decideAction`
**Date:** 2026-05-03.  
**Decision:** When `--retry-wake N` is set and the SSH poll times out, `executePlan`'s `wait` case re-sends the magic packet and re-polls, up to N more times, before throwing `SSH_TIMEOUT`. `decideAction` is not modified — it still returns the same static step list regardless of `retryWake`.  
**Why:** `decideAction` is a pure function mapping `(state, flags) → steps[]`. Inserting dynamic retry-wake steps into the plan (e.g. `[wake, wait, retry-wake, wait, retry-wake, wait, ...]`) would require `decideAction` to know `retryWake` and loop — making it stateful and harder to exhaustively test the state matrix. The retry is an implementation detail of the `wait` step: "keep trying to reach SSH, with occasional re-wakes." This keeps `decideAction` tests unchanged and localises the retry logic to one switch case.  
**Alternatives considered:** Inserting explicit `retry-wake` step records into `decideAction`'s output (rejected: complicates the planner and test matrix); a separate outer retry loop wrapping the full plan (rejected: re-runs wake + all subsequent steps, not just the SSH poll).  
**Status:** Active.

---

## 12. `--user` does not auto-default to `$USER`
**Date:** 2026-05-02 (post real-world testing — surfaced as a bug).  
**Decision:** When `--user` is not passed, `opts.user` stays `null` and `buildSshArgs` emits the bare host (e.g. `mymachine-ubuntu`) rather than `<user>@<host>`. SSH then resolves the user from `~/.ssh/config`'s Host block (or from its own `$USER` fallback if no Host block matches).  
**Why:** The original code defaulted `opts.user = process.env.USER ?? null`. This injected the local username into the SSH target string, which **overrode** any `User` directive in the matching `~/.ssh/config` Host block. Real-world bug: with `Host mymachine-ubuntu` defining `User adminuser`, running `oi-wake-verify mymachine-ubuntu …` produced `ssh localuser@mymachine-ubuntu …` instead of `ssh adminuser@mymachine-ubuntu`. SSH config got silently ignored. The fix: don't inject what SSH already handles. Passing the bare alias lets `~/.ssh/config` do its job.  
**Alternatives considered:**
- Keep auto-default but warn when `~/.ssh/config` has a conflicting User directive (rejected: requires parsing ~/.ssh/config in the tool; defeats the "let ssh handle resolution" principle).
- Make auto-default opt-in via a new flag (rejected: adds a flag to fix a thing that should never have happened).

Help text was updated from `--user <user>  SSH user (default: $USER)` to `--user <user>  SSH user (default: ssh's resolution — User from ~/.ssh/config Host block, else $USER)` to make the actual behaviour discoverable.  
**Status:** Active.
