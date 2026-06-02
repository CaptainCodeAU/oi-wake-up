# oi-wake-up

Wake-on-LAN done right. No dependencies, just Node.js.

Default branch is `master`.

## Tech stack

- Node.js (ES modules)
- Built-in modules only: `dgram`, `net`, `child_process`, `fs`, `url`, `path`
- pnpm for package management (npm is banned; bun acceptable)
- nvm for Node version management

## Project structure

```
oi-wake-up/
├── src/
│   ├── index.js          # Core library (parseMAC, isValidMAC, createMagicPacket, wake, wakeMany)
│   ├── verify.js         # oi-wake-verify internals (parse, decideAction, executePlan, probe, poll, remediate, logger, VerifyError, EXIT)
│   ├── sleep.js          # oi-wake-down internals (parseSleepArgs, decideSleepAction, executeSleepPlan, SleepError, EXIT)
│   └── spawn.js          # spawnSsh — testable boundary for ssh subprocess
├── bin/
│   ├── cli.js            # oi-wake-up — magic packet sender
│   ├── verify.js         # oi-wake-verify — wake + ssh probe + remediation
│   └── sleep.js          # oi-wake-down — remote sleep via SSH
├── tests/
│   ├── index.test.js     # Tests for src/index.js
│   ├── verify.test.js    # Tests for src/verify.js (parse, decide, logger, orchestrator, executePlan)
│   ├── sleep.test.js     # Tests for src/sleep.js (parse, decide, executor, connection-drop handling)
│   ├── spawn-fake.js     # Recording fake for spawnSsh — used by verify.test.js and sleep.test.js
│   └── dgram-fake.js     # Recording fake for dgram socket factory — used by index.test.js
├── docs/
│   ├── ROADMAP.md        # Done / in-progress / planned / parked
│   ├── DECISIONS.md      # Append-only design-decisions log
│   ├── METAPROMPT.md     # Saved opening prompts for fresh sessions
│   ├── IDEAS.md          # Parking lot for unstarted ideas
│   └── GLOSSARY.md       # WoL terminology lookup
├── Plans/                # Active and historical implementation plans
├── .nvmrc
├── .envrc                # direnv auto-activation
├── package.json
├── README.md
├── LICENSE
└── CLAUDE.md             # This file (project rules — auto-loads on every session)
```

## Commands

- `node bin/cli.js <mac>` — Send magic packet
- `node bin/verify.js <host> --mac <mac>` — Wake + ssh probe + remediate
- `node bin/sleep.js <host>` — Put machine to sleep via SSH
- `pnpm test` — Run tests
- `pnpm install -g .` — Install all three CLIs globally (`oi-wake-up`, `oi-wake-verify`, `oi-wake-down`)

## Key rules

- **Zero external dependencies.** Use only Node.js built-in modules. This is a hard constraint, not a guideline. `bin/verify.js` and `src/verify.js` depend only on `src/index.js` and Node built-ins — no new runtime deps.
- **pnpm is canonical; npm is banned.** Bun is acceptable. Never write `npm install`, `npm i`, `npm publish`, `npx`, etc. — use pnpm equivalents.
- **No npm publishing.** This project ships via `pnpm install -g .` from a local clone. Do not suggest publishing to the npm registry.
- **Args + shell aliases over config files.** For personal-use CLIs, CLI flags + shell aliases are the personalisation layer. Don't add JSON/YAML/TOML config files unless explicitly requested. See `docs/DECISIONS.md`.
- **For new features: read `Plans/` first.** The plan file is source of truth — do not re-derive design decisions captured there.
- **Use `node:test`**, not vitest or any other test framework.
- **Run tests after every change.**

## How to verify

1. `pnpm test` — all tests pass
2. `node bin/cli.js 00:11:22:33:44:55` — sends magic packet, prints confirmation
3. `pnpm install -g .` then `oi-wake-up --help` — CLI works globally
4. `node bin/verify.js --help` and (after `pnpm install -g .`) `oi-wake-verify --help` both work
5. Verify packet structure with Wireshark / `tcpdump -i any -n udp port 9 -X` if needed

---

## Python

Use `uv run python3` instead of calling `python3` directly. (A shell wrapper intercepts bare `python`/`python3` and version-specific calls like `py313`/`py312` and redirects to `uv run` — but invoke `uv run` directly rather than relying on the wrapper, since non-interactive Bash-tool shells skip `.zshrc` and the wrapper is absent there.)
For standalone scripts needing third-party libs, use PEP 723 inline metadata (`# /// script` block) — `uv run` resolves it automatically.
Package management is `uv`, not pip/pipx: use `uv add` / `uv remove` (not `pip install` / `pip uninstall`), and `uv tool` (not `pipx`). The same wrapper-absence caveat applies — in the Bash tool, `pip install` hits real pip, so call `uv` directly.

## Node / JS package manager

Never use `npm` or `yarn`. Use `pnpm` (or `bun`). Pick by lockfile:

- `pnpm-lock.yaml` present → use pnpm.
- `bun.lockb` / `bun.lock` present → use bun.
- No lockfile → default to pnpm.
- Only `package-lock.json` or `yarn.lock` present → disregard them, use pnpm anyway (do not run npm/yarn to honor them).
  For one-off package execution prefer `pnpm dlx` over `npx`.

## Source files — encoding

Emit only ASCII punctuation in source code: straight quotes (`"` `'`), straight apostrophes, and hyphen-minus (`-`). Never write Unicode smart quotes (`" " ' '`), en/em dashes (`– —`), or other Unicode punctuation into code files — they pass type-checks but break the build at transform time (the JS/TS build rejects them), and hunting them down afterward wastes a session. Unicode is fine in comments, docs, and string literals meant for display; never in identifiers, keys, or code tokens.

## Shell

Shell has `NULL_GLOB` + `nonomatch` — use `find -print` (not `ls glob*`) for file existence checks.
For port listing use the `ports` function (OS-aware: `lsof` on macOS, `ss`/`netstat` on Linux/WSL) rather than calling those tools directly.

## Editing

Before editing a file, run `grep -cP '\t' <file>` to detect tab indentation — match exactly or the Edit tool will fail.

## Deletion safety

`rm`, `cp`, and `mv` are shell-function wrappers with safety behavior (rm routes to trash; cp/mv default to `-i` overwrite prompts). These wrappers are NEVER active in Bash tool calls — non-interactive shells skip `.zshrc`, so any `rm`/`cp`/`mv` here hits `/bin/rm` etc. directly: deletions are permanent and overwrites are silent. Always get explicit user confirmation before deleting or overwriting files. A `~/.config/safe-rm` denylist exists but does NOT protect you in the Bash tool either — don't rely on it.
