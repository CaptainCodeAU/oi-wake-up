# Meta Prompts

Saved opening prompts for fresh Claude Code sessions. Copy the relevant fenced block, paste it into a new Claude Code session in this repo's root, and Claude will bootstrap with full context — no need to re-derive design decisions or explain the project.

Three prompts live here:

1. **Iteration: oi-wake-verify v1.2 polish** — for picking up the v1.2 candidates (capture-verify, accept-new-host, forward-agent, two-stage liveness probe, default-verbosity stderr surfacing) on the already-shipped tool.
2. **Implementation: docs reorganisation** — for adapting or extending the docs structure (the initial reorg is already done).
3. **Continue design conversation** — for *talking* about design / further refinements.

Don't confuse them. Implementation prompts assume you want code written; the design-conversation prompt assumes you want to keep iterating on ideas.

---

## Iteration: oi-wake-verify v1.2 polish

The v1.1 binary `oi-wake-verify` shipped 2026-05-02 — five state-machine cells exercised end-to-end against real hardware, two real bugs found-and-fixed in the process (post-remediate grace, no-`$USER`-auto-default), 57/57 tests passing. This prompt is for picking up the v1.2 candidates that surfaced during that testing but were parked rather than scope-creep into v1.1.

```
You're picking up follow-up work on a shipped tool. The CLI itself is in
production use; this iteration adds observability and ergonomics polish.

## Working directory
~/CODE/CaptainCodeAU/oi-wake-up

## Current state (do not re-derive)
- v1.1 has shipped. `bin/verify.js`, `src/verify.js`, `src/spawn.js` exist and
  work end-to-end. Read `docs/ROADMAP.md` for the shipped scope and the
  documented v1.2 candidate list.
- 57/57 unit tests in `tests/verify.test.js` are green. Don't break them.
- Real-world operating example is in `README.md` (worked example with
  `--grace 25` and `bash -lc` wrapping rationale).

## Read these first, in this order
1. CLAUDE.md                                     ← auto-loaded; read explicitly anyway
2. docs/ROADMAP.md                               ← shipped scope + v1.2 candidate list
3. docs/IDEAS.md                                 ← v1.2 candidate detail with rationale
4. docs/DECISIONS.md                             ← binding design decisions, including the
                                                   two real bugs found-and-fixed during testing
5. bin/verify.js + src/verify.js                 ← the actual code; understand it before extending
6. tests/verify.test.js                          ← extend, don't replace; match the existing style
7. README.md                                     ← user-facing surface; update if you add flags

## Hard constraints (non-negotiable, carried from v1.1)
- Zero new runtime dependencies. Node built-ins only.
- ESM only. Tabs for indentation. Manual `switch`/`case` arg parsing.
- Tests via `node:test` + `node:assert/strict`. No test framework dependency.
- pnpm-only. Bun acceptable. Never `npm`.
- No config file. CLI args + shell aliases are canonical.

## Pick one candidate per session
Don't bundle multiple v1.2 features into one PR. Each is independently
shippable; treat them as separate iterations. The order I'd recommend
(per the SSH-territory agent's review of the v1.1 testing transcript):

1. **Surface probe stderr at default verbosity on probe failure** — do this
   first. One-line change in the executor + one or two tests. General-purpose
   diagnostic win that catches host-key failures, auth failures, sshd-down,
   timeouts — all of which today look identical at default verbosity ("probe
   failed → unreachable"). Ship before any host-key-specific shortcut.
2. **`--capture-verify`** — concrete automation need, surfaced repeatedly
   during testing. ~30 LOC + ~3 tests.
3. **`--accept-new-host`** — only after #1. Silently auto-accepting host keys
   the user can't see (because probe stderr is still buried) would be worse
   than the current footgun. Ship this as the explicit fix once #1 makes the
   failure visible.
4. **`--forward-agent`** flag — small, but lower priority (no current
   consumer).
5. **ICMP-pre-probe two-stage liveness** — biggest design surface; do last,
   or write a fresh plan in `Plans/` first.

## Workflow
1. Pick a single candidate from the list and confirm with me which.
2. Sketch the surface change (new flag, struct field, behaviour) before writing.
3. Implement; extend tests; verify `pnpm test` green.
4. Update README + DECISIONS if surface or behaviour changed.
5. Move the candidate from `IDEAS.md` to `ROADMAP.md` "Released" section.

## Don't
- Don't commit anything unless I explicitly ask.
- Don't bundle multiple v1.2 candidates.
- Don't refactor `src/index.js` (the WoL core) or `bin/cli.js` (the original
  `oi-wake-up` binary) while you're in here.
- Don't break existing v1.1 tests. If a candidate genuinely needs a behaviour
  change to existing tests, surface it before changing them.

Begin by reading ROADMAP, IDEAS, and DECISIONS, then ask me which candidate
to start with.
```

---

## Implementation: docs reorganisation

The initial reorg is already done (see `Plans/docs-reorg.md` for what was executed). This prompt is for **future docs maintenance** — adding new docs, migrating content, refining structure.

```
You're picking up documentation maintenance work in an existing Node.js project.
The initial docs reorganisation has already been done.

## Working directory
~/CODE/CaptainCodeAU/oi-wake-up

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
~/.claude/projects/<your-project-memory>/memory/
should auto-load and give you most of the context (my preferences, project
state, the 3090 box, SSH conventions). Read MEMORY.md first if it isn't
already loaded.

## Working directory
~/CODE/CaptainCodeAU/oi-wake-up

## What this project is
`oi-wake-up` — a zero-dependency Wake-on-LAN CLI + library in pure Node.js.
Public repo, MIT, installed globally via `pnpm link --global` or
`pnpm add -g github:CaptainCodeAU/oi-wake-up`. The tool I use daily to wake
my RTX 3090 LLM rig (host alias `mymachine`).

## What's currently shipped (as of 2026-05-02)
Two binaries:
- `oi-wake-up` — the original WoL packet sender (v1.0).
- `oi-wake-verify` — wake → SSH probe → remediation → verify, in one
  idempotent command (v1.1, shipped 2026-05-02). Composes `wake` and
  `isValidMAC` from `src/index.js`. Tested end-to-end against the RTX 3090
  including the post-resume CUDA passthrough rebind path.

## What might be in flight
v1.2 candidates surfaced during v1.1 real-world testing — `--capture-verify`,
`--forward-agent`, `--accept-new-host`, ICMP-pre-probe two-stage liveness,
default-verbosity probe stderr surfacing. None scheduled. See
`docs/ROADMAP.md` "Planned" and `docs/IDEAS.md` for detail.

## Source of truth
- `docs/DECISIONS.md` — append-only design decisions log (12 entries as of
  2026-05-02). Includes the two bugs found-and-fixed during real-world testing.
- `docs/ROADMAP.md` — shipped scope + v1.2 candidate list.
- `Plans/i-have-completely-banned-wild-quilt.md` — historical v1.1 design
  plan (complete; preserved as historical record).

**Do not re-litigate decisions captured in DECISIONS.md.** Settled:
- Args-only design (no config file)
- pnpm-only (no npm anywhere — ever)
- Same repo, second binary in package.json `bin` map
- Zero new runtime dependencies (Node built-ins only)
- Reuses `wake` and `isValidMAC` from src/index.js
- `--grace` applies in two places (post-SSH-up and post-remediate); `--user`
  doesn't auto-default to `$USER`; `--verify` should test the failing layer
  (timed inference), not nvidia-smi.

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
