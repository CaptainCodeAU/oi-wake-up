# oi-wake-up — Full Specification

A CLI and library for sending Wake-on-LAN magic packets in pure Node.js.

---

## 1. Overview

Wake-on-LAN (WoL) works by sending a "magic packet" to a network broadcast
address. The packet contains a sync stream (6 bytes of 0xFF) followed by
the target MAC address repeated 16 times. Any WoL-enabled NIC that
recognizes its own MAC in the payload will power on its machine.

---

## 2. Magic Packet Structure

```
┌─────────────────────────────────────────────────────────────┐
│  6 bytes: 0xFF 0xFF 0xFF 0xFF 0xFF 0xFF  (sync stream)      │
├─────────────────────────────────────────────────────────────┤
│  6 bytes: MAC address (1st repetition)                      │
│  6 bytes: MAC address (2nd repetition)                      │
│  ...                                                        │
│  6 bytes: MAC address (16th repetition)                     │
└─────────────────────────────────────────────────────────────┘
Total: 6 + (6 × 16) = 102 bytes
```

---

## 3. Supported MAC Address Formats

The library must accept all common formats:

| Format    | Example             | Delimiter |
| --------- | ------------------- | --------- |
| Canonical | `01:02:03:04:05:06` | colon     |
| Windows   | `01-02-03-04-05-06` | hyphen    |
| Bare      | `010203040506`      | none      |

Validation rules:

- After removing delimiters, must be exactly 12 hex characters
- Case-insensitive (accept `AA:BB:CC` and `aa:bb:cc`)

---

## 4. API Design

### 4.1 Library API (`src/index.js`)

```javascript
import { wake } from 'oi-wake-up';

// Basic usage (defaults: broadcast 255.255.255.255, port 9)
await wake('01:02:03:04:05:06');

// With options
await wake('01:02:03:04:05:06', {
	address: '192.168.1.255', // Subnet broadcast
	port: 7, // Alternative port
});
```

**Exports:**

- `wake(mac, options?)` — Main function. Returns Promise<void>.
- `createMagicPacket(mac)` — Returns Buffer (102 bytes). Useful for testing.
- `parseMAC(mac)` — Returns Buffer (6 bytes) or throws on invalid input.
- `isValidMAC(mac)` — Returns boolean.

**Options object:**

```javascript
{
  address: string,  // Default: '255.255.255.255'
  port: number      // Default: 9 (discard port)
}
```

**Errors:**

- Throw `Error` with message `Invalid MAC address: <input>` for bad MACs
- Let Node's dgram errors propagate for network failures

### 4.2 CLI (`bin/cli.js`)

```
Usage: oi-wake-up [options] <mac> [mac...]

Arguments:
  mac                    MAC address(es) to wake

Options:
  -i, --address <ip>     Destination IP (default: "255.255.255.255")
  -p, --port <number>    Destination port (default: 9)
  -q, --quiet            Suppress output
  -f, --file <path>      Read MAC addresses from file
  -d, --delay <ms>       Delay between packets in ms (default: 0)
  -v, --version          Show version
  -h, --help             Show help
```

**File format (-f):**

```
# Comments start with #
# Blank lines are ignored
# Format: MAC [IP] [PORT]

01:02:03:04:05:06
01:02:03:04:05:07 192.168.1.255
01:02:03:04:05:08 192.168.1.255 7
```

**Exit codes:**

- 0: Success (at least one packet sent)
- 1: Error (invalid args, no valid MACs, network error)

---

## 5. File Responsibilities

### `src/index.js`

- MAC address parsing and validation
- Magic packet construction
- UDP socket creation and broadcast
- All exports (wake, createMagicPacket, parseMAC, isValidMAC)

### `bin/cli.js`

- Argument parsing (use manual parsing, no dependencies)
- File reading for -f option
- Console output
- Exit code handling
- Shebang: `#!/usr/bin/env node`

### `tests/index.test.js`

- Unit tests using `node:test` and `node:assert`
- Test MAC parsing (valid formats, invalid inputs)
- Test magic packet structure (correct length, correct bytes)
- No network tests (would require mocking dgram)

---

## 6. package.json

```json
{
	"name": "oi-wake-up",
	"version": "1.0.0",
	"description": "Wake-on-LAN done right. No dependencies, just Node.js.",
	"type": "module",
	"main": "./src/index.js",
	"exports": {
		".": {
			"import": "./src/index.js"
		}
	},
	"bin": {
		"oi-wake-up": "./bin/cli.js"
	},
	"files": ["src", "bin"],
	"scripts": {
		"test": "node --test",
		"test:watch": "node --test --watch"
	},
	"keywords": ["wake-on-lan", "wol", "magic-packet", "network", "wake"],
	"author": "",
	"license": "MIT",
	"repository": {
		"type": "git",
		"url": "git+https://github.com/AshGw/oi-wake-up.git"
	},
	"engines": {
		"node": ">=18.0.0"
	},
	"packageManager": "pnpm@9.0.0"
}
```

---

## 7. Environment Files

### 7.1 .nvmrc

Create with current Node version:

```
v22.x.x
```

(Use actual version from `nvm current`)

### 7.2 .envrc

Create direnv integration for auto-environment display:

```bash
# oi-wake-up Node.js Environment

# Auto-switch Node version via nvm
if [[ -f ".nvmrc" ]] && command -v nvm &>/dev/null; then
    nvm use --silent 2>/dev/null || nvm use
fi

# Clear the "direnv: loading..." line
printf "\033[A\033[2K"

echo ""
echo "┌───────────────────────────────────────────────────────────────────────┐"
echo -e "│                        \033[32m📦 oi-wake-up\033[0m                                 │"
echo "└───────────────────────────────────────────────────────────────────────┘"
echo "│"
echo "│  🚀 Quick Start:"
echo "│  ──────────────"
echo -e "│     \033[3;33mpnpm test\033[0m                  # Run tests"
echo -e "│     \033[3;33mnode bin/cli.js <mac>\033[0m      # Send magic packet"
echo -e "│     \033[3;33mpnpm link --global\033[0m         # Install CLI globally"
echo "│"
echo "│  📡 Usage Examples:"
echo "│  ─────────────────"
echo -e "│     \033[3;33moi-wake-up AA:BB:CC:DD:EE:FF\033[0m"
echo -e "│     \033[3;33moi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF\033[0m"
echo -e "│     \033[3;33moi-wake-up -f machines.wol\033[0m"
echo "│"
echo "│  ℹ️  Info:"
echo "│  ────────"
echo -e "│     Node:    \033[36m$(node --version 2>/dev/null || echo 'N/A')\033[0m"
echo -e "│     pnpm:    \033[36m$(pnpm --version 2>/dev/null || echo 'N/A')\033[0m"
local _pkg_version
_pkg_version=$(jq -r '.version // "1.0.0"' package.json 2>/dev/null || echo "1.0.0")
echo -e "│     Version: \033[36m${_pkg_version}\033[0m"
echo "│"
echo "│  🔗 Global Link Status:"
echo "│  ──────────────────────"
if pnpm list --global 2>/dev/null | grep -q "oi-wake-up"; then
    echo -e "│     Link:    \033[32m✓ Linked globally\033[0m"
else
    echo -e "│     Link:    \033[33m✗ Not linked\033[0m  →  \033[3;33mpnpm link --global\033[0m"
fi
echo "│"
echo "└───────────────────────────────────────────────────────────────────────┘"
echo ""
```

### 7.3 .gitignore

```
# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Dependencies
node_modules/

# Build output
dist/

# Test / Coverage
coverage/

# Environment
.env
.env.local

# OS
.DS_Store

# Editor
.idea/
.vscode/
*.swp
```

---

## 8. Implementation Phases

### Phase 1: Project Setup

1. Run `pnpm init`
2. Create directory structure: `src/`, `bin/`, `tests/`
3. Create `.nvmrc` with current Node version
4. Create `.gitignore`
5. Update `package.json` with full config from Section 6

### Phase 2: Core Library

1. Create `src/index.js`
2. Implement `parseMAC(mac)` — normalize and validate MAC, return 6-byte Buffer
3. Implement `isValidMAC(mac)` — return boolean
4. Implement `createMagicPacket(mac)` — return 102-byte Buffer
5. Implement `wake(mac, options)` — create UDP socket, send packet

### Phase 3: Tests

1. Create `tests/index.test.js`
2. Test `parseMAC` with valid formats (colon, hyphen, bare)
3. Test `parseMAC` with invalid inputs (throws)
4. Test `isValidMAC` returns correct booleans
5. Test `createMagicPacket` structure (length, sync bytes, MAC repetition)
6. Verify with `pnpm test`

### Phase 4: CLI

1. Create `bin/cli.js` with shebang `#!/usr/bin/env node`
2. Implement argument parsing (manual, no dependencies)
3. Implement help (`-h, --help`) and version (`-v, --version`) output
4. Implement single MAC sending
5. Implement multiple MAC sending
6. Implement file reading (`-f`)
7. Implement delay between packets (`-d`)
8. Implement quiet mode (`-q`)

### Phase 5: Polish

1. Create `.envrc` for direnv integration
2. Run `direnv allow .`
3. Add README.md with usage examples
4. Add LICENSE (MIT)
5. Verify `pnpm link --global` works
6. Test CLI end-to-end: `oi-wake-up --help`

---

## 9. Edge Cases

- Empty MAC string → throw "Invalid MAC address: "
- MAC with wrong length → throw "Invalid MAC address: <input>"
- MAC with invalid hex chars → throw "Invalid MAC address: <input>"
- Port out of range (< 0 or > 65535) → throw "Invalid port: <input>"
- File not found (-f) → print error, exit 1
- Empty file (-f) → print "No MAC addresses found", exit 1
- Mixed valid/invalid MACs → send valid ones, warn about invalid, exit 0 if any sent
- Network error → print error, exit 1

---

## 10. Example Session

After implementation, a typical workflow:

```bash
cd oi-wake-up

# direnv auto-loads, shows project info box

# Run tests
pnpm test

# Test CLI locally
node bin/cli.js AA:BB:CC:DD:EE:FF

# Link globally
pnpm link --global

# Use from anywhere
oi-wake-up AA:BB:CC:DD:EE:FF
oi-wake-up -i 192.168.1.255 AA:BB:CC:DD:EE:FF
oi-wake-up -f ~/machines.wol
```
