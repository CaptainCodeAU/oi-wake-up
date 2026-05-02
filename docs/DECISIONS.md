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
**Why:** The user's existing `wakeup` alias pattern (`oi-wake-up -i 192.168.1.255 04:7C:16:40:B4:B3`) proves the model works. Aliases live in `~/.zshrc` (or `~/.ssh/config` for SSH-related values) where they belong; a config file would duplicate functionality. Public-repo users copy example aliases from the README.  
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
**Decision:** For remediation commands targeting the RTX 3090 (`mlbox`), use SSH directly to the WSL Ubuntu sshd on port 2522, not via Windows OpenSSH (port 22) + `wsl.exe`.  
**Why:** Windows OpenSSH defaults to PowerShell as the remote shell, which (a) parses commands with PowerShell quoting rules instead of bash, (b) breaks `ssh-copy-id` (POSIX shell snippets fail), (c) has the Windows-Admin-keys quirk (`C:\ProgramData\ssh\administrators_authorized_keys`). The WSL-direct path lands in bash, sidesteps all three issues, and is the only path with key auth currently set up.  
**Alternatives considered:** Windows-port-22 with `wsl.exe -d Ubuntu --` shim — works but requires PowerShell-friendly quoting and the Windows admin-keys workaround. Documented as fallback only.  
**Status:** Active.
