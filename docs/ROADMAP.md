# Roadmap

Last updated: 2026-05-02

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

---

## In progress

### Documentation reorganisation (2026-05-02)
- ✓ Move `docs/CLAUDE.md` → `CLAUDE.md` (root) — auto-loads on every session
- ✓ Delete `docs/SPEC.md` (60% obsolete, rest covered by README)
- ✓ Update README install section (GitHub-direct install + zero-dep risk note)
- ✓ Create this `ROADMAP.md`
- ✓ Create `docs/DECISIONS.md` (7 seed entries)
- ✓ Create `docs/METAPROMPT.md` (3 saved prompts)
- ✓ Create `docs/IDEAS.md` (4 seed bullets)
- ✓ Create `docs/GLOSSARY.md` (~10 WoL terms)
- 🟡 Cross-link Plans → METAPROMPT.md sections

Plan: `Plans/docs-reorg.md`

---

## Planned

### v1.1.0 — `oi-wake-verify` (second binary)
- ☐ New CLI: wake → SSH probe → remediation → verify, in one command
- ☐ Composes existing `wake` and `isValidMAC` from `src/index.js`
- ☐ Zero new runtime dependencies
- ☐ Args-only personalisation (no config file)
- ☐ Stable exit codes (0 / 1 / 2 / 3 / 4 / 5 / 64 / 130)
- ☐ Verbosity tiers: quiet / default / verbose / debug + `--json`

Drives: post-resume CUDA passthrough fix on the RTX 3090 LLM rig.  
Plan: `Plans/i-have-completely-banned-wild-quilt.md`  
Implementation prompt: `docs/METAPROMPT.md` → "Implementation: oi-wake-verify"

---

## Out of scope / parked

- ⊘ **Publishing to npm registry** — use `pnpm add -g github:CaptainCodeAU/oi-wake-up` instead. See `DECISIONS.md` #4.
- ⊘ **Configuration file support** (JSON/YAML/TOML) — args + shell aliases are canonical. See `DECISIONS.md` #5.
- ⊘ **Multi-target orchestration / `--all` mode** — YAGNI until 3+ targets needed.
- ⊘ **Notification integration** (Pushover / ntfy / Slack) — better as a post-hook than baked in.
- ⊘ **Daemon / scheduler-aware mode** — separate tool's job.
- ⊘ **Auto-detect MAC from ARP cache** — see `IDEAS.md` for current thinking.
