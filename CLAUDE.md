# oi-wake-up

Wake-on-LAN done right. No dependencies, just Node.js.

## Tech stack

- Node.js (ES modules)
- Built-in modules only: `dgram`, `net`, `child_process`, `fs`, `url`, `path`
- pnpm for package management (npm is banned; bun acceptable)
- nvm for Node version management

## Project structure

```
oi-wake-up/
├── src/
│   └── index.js          # Core library (wake function, MAC parsing, packet building)
├── bin/
│   └── cli.js            # oi-wake-up — magic packet sender
│                         # bin/verify.js (oi-wake-verify) — planned, see Plans/
├── tests/
│   └── index.test.js     # Tests using node:test
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
- `pnpm test` — Run tests
- `pnpm link --global` — Install CLI globally as `oi-wake-up`
- `pnpm add -g github:CaptainCodeAU/oi-wake-up` — Install from GitHub (no clone needed)

## Key rules

- **Zero external dependencies.** Use only Node.js built-in modules. This is a hard constraint, not a guideline.
- **pnpm is canonical; npm is banned.** Bun is acceptable. Never write `npm install`, `npm i`, `npm publish`, `npx`, etc. — use pnpm equivalents.
- **No npm publishing.** This project ships via `pnpm add -g github:CaptainCodeAU/oi-wake-up` (or local `pnpm link --global`). Do not suggest publishing to the npm registry.
- **Args + shell aliases over config files.** For personal-use CLIs, CLI flags + shell aliases are the personalisation layer. Don't add JSON/YAML/TOML config files unless explicitly requested. See `docs/DECISIONS.md`.
- **For new features: read `Plans/` first.** The plan file is source of truth — do not re-derive design decisions captured there.
- **Use `node:test`**, not vitest or any other test framework.
- **Run tests after every change.**

## How to verify

1. `pnpm test` — all tests pass
2. `node bin/cli.js 00:11:22:33:44:55` — sends magic packet, prints confirmation
3. `pnpm link --global` then `oi-wake-up --help` — CLI works globally
4. (When `bin/verify.js` exists) `node bin/verify.js --help` and `oi-wake-verify --help` both work
5. Verify packet structure with Wireshark / `tcpdump -i any -n udp port 9 -X` if needed
