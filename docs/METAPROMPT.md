# Meta Prompts

Saved opening prompts for fresh Claude Code sessions. Copy the relevant fenced block, paste it into a new Claude Code session in this repo's root, and Claude will bootstrap with full context — no need to re-derive design decisions or explain the project.

Three prompts live here:

1. **Implementation: oi-wake-verify** — for *building* the planned second binary.
2. **Implementation: docs reorganisation** — for adapting or extending the docs structure (the initial reorg is already done).
3. **Continue design conversation** — for *talking* about design / further refinements.

Don't confuse them. Implementation prompts assume you want code written; the design-conversation prompt assumes you want to keep iterating on ideas.

---

## Implementation: oi-wake-verify

```
You're picking up an implementation task in an existing project. Start cold —
read the plan and the surrounding code before you write anything.

## Working directory
/Users/fonzarelli/CODE/CaptainCodeAU/oi-wake-up

## What you're building
A second CLI binary for this repo: `oi-wake-verify` — wakes a remote machine
via WoL (only if it's actually asleep), waits for SSH, runs a remediation
command, optionally verifies. Composes the existing `oi-wake-up` library;
same repo, second `bin` entry.

## Read these first, in this order
1. CLAUDE.md                                     ← project rules (auto-loaded; read it explicitly anyway)
2. Plans/i-have-completely-banned-wild-quilt.md  ← the full plan, source of truth
3. docs/DECISIONS.md                             ← rationale for binding decisions
4. src/index.js                                  ← reuse `wake` and `isValidMAC` from here
5. bin/cli.js                                    ← match this style exactly
6. tests/index.test.js                           ← match this test style exactly
7. package.json                                  ← see existing `bin` map and pnpm pin

## Hard constraints (non-negotiable)
- Zero new runtime dependencies. Node built-ins only (`node:dgram`,
  `node:child_process`, `node:net`, `node:fs`, `node:url`, `node:path`).
- ESM only. Tabs for indentation. Manual `switch`/`case` arg parsing — no
  commander, no yargs, no nothing.
- Tests via `node:test` + `node:assert/strict`. No test framework dependency.
- Package manager: pnpm only. Do NOT use npm anywhere — not in commands, not
  in docs, not in suggestions. Bun is acceptable as an alternative.
- No config file. CLI args + shell aliases are canonical. Don't add JSON/YAML/
  TOML config support. The plan's "Non-goals" section is binding.
- Don't publish or suggest publishing to npm.

## Workflow
1. Read the plan in full. It has Context, Goals, State Machine, CLI Surface,
   Step-by-step Implementation Order, Pitfalls, and Verification.
2. Implement the steps in the order listed in the plan.
3. After each step, run its `Verify:` line and confirm before moving on.
4. End with the full Verification section at the bottom of the plan.
5. Don't expand scope. Items in "Future / Out-of-Scope" stay there.

## Stylistic notes the plan doesn't repeat
- JSDoc comments on exported functions (see `src/index.js` for the pattern).
- `fileURLToPath(import.meta.url)` for `__dirname` equivalent — already used
  in `bin/cli.js`.
- Read version dynamically from `package.json` for `--version` — already used
  in `bin/cli.js`.
- `chmod +x bin/verify.js` after creating it (the existing `bin/cli.js` is +x).

## Don't
- Don't commit anything unless I explicitly ask.
- Don't invent features beyond the plan's CLI Surface section.
- Don't refactor `src/index.js` or `bin/cli.js` while you're in here.
- Don't add a config file. Don't add a config file. Don't add a config file.

Begin by reading the plan, then summarize back to me your understanding and
the order you'll work in before touching any code.
```

---

## Implementation: docs reorganisation

The initial reorg is already done (see `Plans/docs-reorg.md` for what was executed). This prompt is for **future docs maintenance** — adding new docs, migrating content, refining structure.

```
You're picking up documentation maintenance work in an existing Node.js project.
The initial docs reorganisation has already been done.

## Working directory
/Users/fonzarelli/CODE/CaptainCodeAU/oi-wake-up

## Current docs state
- CLAUDE.md (root) — project rules, auto-loaded
- README.md — user-facing entry point with comprehensive WoL troubleshooting
- docs/ROADMAP.md — done / in-progress / planned / parked
- docs/DECISIONS.md — append-only design decisions log
- docs/METAPROMPT.md — saved opening prompts (this file)
- docs/IDEAS.md — parking lot for unstarted ideas
- docs/GLOSSARY.md — WoL terminology
- Plans/*.md — active and historical implementation plans

## Source documents for context
- The original reorg plan: Plans/docs-reorg.md
- The active oi-wake-verify plan: Plans/i-have-completely-banned-wild-quilt.md

## What you might be asked to do
- Add a new doc following the established pattern (small, single-purpose,
  low-maintenance).
- Migrate content between existing docs.
- Update ROADMAP.md as work progresses (move items between done / in-progress
  / planned).
- Append to DECISIONS.md when new design decisions are made.
- Add to IDEAS.md when ideas come up; promote to ROADMAP.md when actioned.
- Add new prompts to METAPROMPT.md following the existing section pattern.

## Conventions (load-bearing)
- One doc, one purpose. If two docs overlap, merge them.
- Plain markdown. No fancy frontmatter. Tables fine; ASCII diagrams welcome.
- No build-time documents (e.g. SPEC.md style). README + code are canonical.
- DECISIONS.md is append-only; mark superseded entries with `Status: Superseded
  by #N`.
- METAPROMPT.md sections are stable; renaming breaks Plan-file footers.

## Hard constraints
- Don't mention npm anywhere.
- Don't recommend ARCHITECTURE.md, CONTRIBUTING.md, or CHANGELOG.md unless
  explicitly asked. They were considered and deferred.
- Keep README's troubleshooting section in the README — it's the project's
  distinctive asset; splitting it weakens the README.

## Workflow
1. Read CLAUDE.md, ROADMAP.md, DECISIONS.md to understand current state.
2. If asked to add a doc, propose its scope and content briefly first; wait
   for approval.
3. Cross-link any new doc to ROADMAP.md and (if relevant) METAPROMPT.md.
```

---

## Continue design conversation

For when you want to keep iterating on design ideas, not start implementation.

```
You're picking up an in-progress design conversation in a personal Node.js
project. I'm CaptainCodeAU. The memory at
~/.claude/projects/-Users-fonzarelli-CODE-CaptainCodeAU-oi-wake-up/memory/
should auto-load and give you most of the context (my preferences, project
state, the 3090 box, SSH conventions). Read MEMORY.md first if it isn't
already loaded.

## Working directory
/Users/fonzarelli/CODE/CaptainCodeAU/oi-wake-up

## What this project is
`oi-wake-up` — a zero-dependency Wake-on-LAN CLI + library in pure Node.js.
Public repo, MIT, installed globally via `pnpm link --global` or
`pnpm add -g github:CaptainCodeAU/oi-wake-up`. The tool I use daily to wake
my RTX 3090 LLM rig (host alias `mlbox`).

## What's currently being designed (not yet implemented)
A second binary, `oi-wake-verify`, in the same repo. It composes the existing
WoL library with an SSH probe + remediation flow to fix the post-resume CUDA
passthrough bug on the 3090 (Docker container loses GPU when Windows resumes
from sleep; fix is `docker restart llmster` via SSH).

## Source of truth for the design
`Plans/i-have-completely-banned-wild-quilt.md` — read in full before
responding. Source of truth for design, CLI surface, state machine, exit
codes, pitfalls, verification.

**Do not re-litigate decisions captured in the plan or in DECISIONS.md.**
Settled:
- Args-only design (no config file)
- pnpm-only (no npm anywhere — ever)
- Same repo, second binary in package.json `bin` map
- Tool name: `oi-wake-verify`
- Zero new runtime dependencies (Node built-ins only)
- Reuses `wake` and `isValidMAC` from src/index.js

## Where we left off (as of 2026-05-02)
The docs reorganisation has been completed (CLAUDE.md at root; docs/ contains
ROADMAP, DECISIONS, METAPROMPT, IDEAS, GLOSSARY; SPEC.md deleted).

Last open thread before that: a five-layer testing strategy for
`oi-wake-verify` (unit / spawn-mock integration / optional localhost smoke /
containerised scenarios / real-hardware manual) was discussed but not folded
into the plan file. That's the most likely conversation thread to resume.

## How I want you to communicate
Memory captures it; short version:
- Plain English first; ASCII diagrams to visualise mechanisms.
- Save protocol-level depth for follow-ups, not the lead.
- Don't overengineer; minimal scope; no surprise refactors.
- Don't mention npm. Use pnpm; bun is acceptable.
- For exploratory questions: 2–3 sentences with a recommendation + tradeoff;
  don't implement until I agree.
- Mode header at top of every response (your CLAUDE.md will guide this).

## Suggested first move
Read MEMORY.md and `Plans/i-have-completely-banned-wild-quilt.md`. Then a
brief "oriented, ready" — no full summary. Wait for me to direct.
```

---

## Conventions for new prompts

When adding a new prompt to this file:

- **Self-contained.** Assume zero prior context — a fresh Claude in a new session.
- **Point at memory + plans + docs**, don't restate them. Memory auto-loads in this directory; the plan file is on disk; CLAUDE.md is auto-loaded. References stay current; copies drift.
- **Lock in non-negotiable constraints inline.** A fresh Claude is most likely to drift on settled decisions — list them explicitly to block drift before it starts.
- **Distinguish from sibling prompts** so the user picks the right one. Section headings should make the use case obvious: `Implementation:`, `Continue:`, etc.
- **Don't include long content that lives elsewhere.** Reference it.
