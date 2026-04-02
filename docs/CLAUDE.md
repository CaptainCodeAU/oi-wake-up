# oi-wake-up

Wake-on-LAN done right. No dependencies, just Node.js.

## Tech stack

- Node.js (ES modules)
- Built-in modules only: `dgram`, `net`
- pnpm for package management
- nvm for Node version management

## Project structure

```
oi-wake-up/
├── src/
│   └── index.js       # Core library (wake function, MAC parsing, packet building)
├── bin/
│   └── cli.js         # CLI entry point
├── tests/
│   └── index.test.js  # Tests using Node's built-in test runner
├── .nvmrc             # Node version lock
├── .envrc             # direnv auto-activation
├── package.json
├── README.md
├── LICENSE
└── SPEC.md            # Full specification — read before implementing
```

## Commands

- `node bin/cli.js <mac>` — Send magic packet
- `pnpm test` — Run tests
- `pnpm link --global` — Install CLI globally as `oi-wake-up`

## Key rules

- IMPORTANT: Zero external dependencies. Use only Node.js built-in modules.
- Read SPEC.md in full before writing any code.
- Run tests after every change.
- Use Node's built-in test runner (`node:test`), not vitest.
- Create .nvmrc with current Node version.
- Create .envrc for direnv integration (see node helper pattern in SPEC.md).

## How to verify

1. Run `pnpm test` — all tests pass
2. Run `node bin/cli.js 00:11:22:33:44:55` — outputs "Magic packet sent" message
3. Run `pnpm link --global` then `oi-wake-up --help` — CLI works globally
4. Verify packet structure with Wireshark if available
