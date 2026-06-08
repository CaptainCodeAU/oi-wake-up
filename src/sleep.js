import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSshArgs, runRemote, probeSsh, createLogger } from './verify.js';

export { createLogger, probeSsh, buildSshArgs };

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SLEEP_CMD =
	'/mnt/c/Windows/System32/rundll32.exe powrprof.dll,SetSuspendState 0,1,0';

export function getVersion() {
	const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
	return pkg.version;
}

export const HELP_TEXT = `Usage: oi-wake-down <host> [options]

Put a remote machine to sleep via SSH. Idempotent — does nothing if the host
is already unreachable (already asleep).

Default sleep command (Windows via WSL):
  ${DEFAULT_SLEEP_CMD}
  bHibernate=0 (sleep, not hibernate), bForce=1, bWakeupEventsDisabled=0.

  Gotcha: if 'powercfg /h on' is set on the Windows side, this silently
  hibernates instead of sleeping. Fix: run 'powercfg /h off' once on Windows.

Required:
  <host>                     Hostname or SSH alias of the target

SSH parameters:
  -u, --user <user>          SSH user (default: resolved from ~/.ssh/config)
      --ssh-port <number>    SSH port (default: 22)
  -i, --identity <path>      SSH identity file (default: ssh's default)
      --ssh-opt <opt>        Pass-through SSH option, repeatable
                             (e.g. --ssh-opt StrictHostKeyChecking=accept-new)
  -F, --ssh-config <path>    Pass an explicit ssh config file (ssh -F <path>);
                             for contexts where ~/.ssh/config is unreadable

Sleep:
      --command <cmd>        Override sleep command (default: rundll32 SetSuspendState)
      --no-confirm           Fire-and-forget — exit without waiting to confirm sleep
      --probe-timeout <s>    Per-probe ConnectTimeout (default: 2)
  -t, --timeout <s>          Total window to confirm asleep (default: 60)
      --poll <s>             Poll interval for confirm-asleep (default: 3)

Mode flags:
  -n, --dry-run              Print planned actions; perform none

Output:
  -q, --quiet                Errors only
  -v, --verbose              Per-step detail + timings
  -d, --debug                Full SSH transcripts and resolved options
      --json                 Structured JSON to stdout (overrides verbosity)
      --journal <path>       Append JSON journal entry to file (JSONL; one object per line)

Standard:
  -h, --help                 Show this help
      --version              Show version

Note: -d means debug. The sibling tool (oi-wake-up) uses -d for delay.`;

/**
 * @typedef {Object} SleepOptions
 * @property {string} host
 * @property {string|null} user
 * @property {number} sshPort
 * @property {string|null} identity
 * @property {string[]} sshOpts
 * @property {string|null} sshConfig
 * @property {string} command
 * @property {boolean} confirm
 * @property {boolean} dryRun
 * @property {number} probeTimeout
 * @property {number} timeout
 * @property {number} poll
 * @property {'quiet'|'default'|'verbose'|'debug'} level
 * @property {boolean} json
 * @property {string|null} journal
 * @property {boolean} help
 * @property {boolean} version
 */

/**
 * Parse process.argv-style arguments into a SleepOptions object.
 * Throws Error on validation failure.
 * @param {string[]} argv
 * @returns {SleepOptions}
 */
export function parseSleepArgs(argv) {
	/** @type {SleepOptions} */
	const opts = {
		host: '',
		user: null,
		sshPort: 22,
		identity: null,
		sshOpts: [],
		sshConfig: null,
		command: DEFAULT_SLEEP_CMD,
		confirm: true,
		dryRun: false,
		probeTimeout: 2,
		timeout: 60,
		poll: 3,
		level: 'default',
		json: false,
		journal: null,
		help: false,
		version: false,
	};

	const positional = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '-h':
			case '--help':
				opts.help = true;
				return opts;
			case '--version':
				opts.version = true;
				return opts;
			case '-u':
			case '--user':
				opts.user = requireValue(argv, ++i, arg);
				break;
			case '--ssh-port':
				opts.sshPort = parsePort(requireValue(argv, ++i, arg), arg);
				break;
			case '-i':
			case '--identity':
				opts.identity = requireValue(argv, ++i, arg);
				break;
			case '--ssh-opt':
				opts.sshOpts.push(requireValue(argv, ++i, arg));
				break;
			case '-F':
			case '--ssh-config':
				opts.sshConfig = requireValue(argv, ++i, arg);
				break;
			case '--command':
				opts.command = requireValue(argv, ++i, arg);
				break;
			case '--no-confirm':
				opts.confirm = false;
				break;
			case '-n':
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '--probe-timeout':
				opts.probeTimeout = parsePositiveInt(requireValue(argv, ++i, arg), arg);
				break;
			case '-t':
			case '--timeout':
				opts.timeout = parsePositiveInt(requireValue(argv, ++i, arg), arg);
				break;
			case '--poll':
				opts.poll = parsePositiveInt(requireValue(argv, ++i, arg), arg);
				break;
			case '-q':
			case '--quiet':
				opts.level = 'quiet';
				break;
			case '-v':
			case '--verbose':
				opts.level = 'verbose';
				break;
			case '-d':
			case '--debug':
				opts.level = 'debug';
				break;
			case '--json':
				opts.json = true;
				break;
			case '--journal':
				opts.journal = requireValue(argv, ++i, arg);
				break;
			default:
				if (arg.startsWith('-')) {
					throw new Error(`Unknown flag: ${arg}`);
				}
				positional.push(arg);
		}
	}

	if (positional.length === 0) {
		throw new Error('Missing required argument: <host>');
	}
	if (positional.length > 1) {
		throw new Error(`Unexpected extra arguments: ${positional.slice(1).join(' ')}`);
	}
	opts.host = positional[0];

	return opts;
}

// Parse helpers — same semantics as verify.js, kept private here.
function requireValue(argv, i, flag) {
	const v = argv[i];
	if (v === undefined) throw new Error(`${flag} requires a value`);
	return v;
}

function parsePort(value, flag) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || String(n) !== String(value).replace(/^\+/, '')) {
		throw new Error(`${flag}: invalid number: ${value}`);
	}
	if (n < 0 || n > 65535) throw new Error(`${flag}: port out of range: ${value}`);
	return n;
}

function parsePositiveInt(value, flag) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || String(n) !== String(value).replace(/^\+/, '')) {
		throw new Error(`${flag}: invalid number: ${value}`);
	}
	if (n <= 0) throw new Error(`${flag}: must be positive: ${value}`);
	return n;
}

/**
 * @typedef {Object} SleepStep
 * @property {'sleep-cmd'|'confirm-asleep'|'noop'} kind
 * @property {string} [reason]
 */

/**
 * Pure state-machine: given SSH-probe outcome and opts, return ordered steps.
 * @param {'reachable'|'unreachable'} state
 * @param {SleepOptions} opts
 * @returns {SleepStep[]}
 */
export function decideSleepAction(state, opts = {}) {
	if (opts.dryRun) {
		return [{ kind: 'noop', reason: 'dry-run' }];
	}
	if (state === 'unreachable') {
		return [{ kind: 'noop', reason: 'already asleep — no action' }];
	}
	// reachable
	if (!opts.confirm) {
		return [{ kind: 'sleep-cmd' }];
	}
	return [{ kind: 'sleep-cmd' }, { kind: 'confirm-asleep' }];
}

// ---------------------------------------------------------------------------
// EXIT — stable exit-code contract
// ---------------------------------------------------------------------------

export const EXIT = {
	OK: 0,
	MISCONFIG: 1,
	SLEEP_FAILED: 6,
	SLEEP_NOT_CONFIRMED: 7,
	USAGE: 64,
	INTERRUPTED: 130,
};

export class SleepError extends Error {
	constructor(exitCode, message) {
		super(message);
		this.exitCode = exitCode;
	}
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Returns true when the SSH result indicates the sleep command was delivered.
 * A connection drop (exit 255, connection-closed stderr pattern) is treated as
 * success — the host may have slept before rundll32 returned.
 */
function isSleepDelivered(result) {
	if (result.code === 0) return true;
	if (result.code === 255) {
		const combined = (result.stderr + result.stdout).toLowerCase();
		if (/closed|broken pipe|disconnected|reset by peer/.test(combined)) return true;
		// Host went dark with no output at all
		if (!result.stderr.trim() && !result.stdout.trim()) return true;
	}
	return false;
}

function delay(ms, signal) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		if (signal) {
			signal.addEventListener('abort', () => {
				clearTimeout(t);
				reject(new Error('aborted'));
			});
		}
	});
}

/**
 * Poll probeSsh until the host becomes unreachable or timeout elapses.
 */
async function pollUntilUnreachable(opts, onProgress, deps = {}) {
	const sleepFn = deps.sleep ?? ((ms) => delay(ms));
	const start = Date.now();
	const deadline = start + opts.timeout * 1000;
	let attempts = 0;

	while (Date.now() < deadline) {
		if (deps.signal?.aborted) {
			return { ok: false, attempts, totalMs: Date.now() - start };
		}
		attempts++;
		const result = await probeSsh(opts, { spawn: deps.spawn, signal: deps.signal });
		if (onProgress) onProgress(attempts, result.code, result.durationMs);
		if (!result.reachable) {
			return { ok: true, attempts, totalMs: Date.now() - start };
		}
		if (Date.now() + opts.poll * 1000 >= deadline) break;
		await sleepFn(opts.poll * 1000);
	}

	return { ok: false, attempts, totalMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// executeSleepPlan — step dispatcher; exported so library consumers can test
// ---------------------------------------------------------------------------

/**
 * Execute an ordered list of steps returned by decideSleepAction.
 *
 * @param {SleepStep[]} plan
 * @param {SleepOptions} opts
 * @param {{ log: import('./verify.js').Logger, journal: object, total: number, ctrl: AbortController }} ctx
 * @param {{ spawn?: Function, sleep?: Function }} [deps]
 * @returns {Promise<void>}
 */
export async function executeSleepPlan(plan, opts, ctx, deps = {}) {
	const { log, journal, total, ctrl } = ctx;
	let stepNum = 1; // step 1 was the probe

	for (const step of plan) {
		stepNum++;
		switch (step.kind) {
			case 'noop':
				log.step(stepNum, total, step.reason ?? 'no-op');
				journal.steps.push({ kind: 'noop', reason: step.reason });
				return;

			case 'sleep-cmd': {
				log.step(stepNum, total, `Sending sleep command to ${opts.host}`);
				log.debug(`sleep-cmd: ${opts.command}`);
				const r = await runRemote(opts, opts.command, {
					signal: ctrl.signal,
					spawn: deps.spawn,
				});
				log.debug(
					`sleep-cmd: code=${r.code} stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`,
				);
				const delivered = isSleepDelivered(r);
				journal.steps.push({ kind: 'sleep-cmd', code: r.code, delivered, durationMs: r.durationMs });
				if (!delivered) {
					throw new SleepError(
						EXIT.SLEEP_FAILED,
						`sleep command failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim() || 'no output'}`,
					);
				}
				break;
			}

			case 'confirm-asleep': {
				log.step(
					stepNum,
					total,
					`Waiting for ${opts.host} to go unreachable (timeout=${opts.timeout}s, poll=${opts.poll}s)...`,
				);
				const result = await pollUntilUnreachable(
					opts,
					(attempt, code, ms) =>
						log.verbose(`  probe ${attempt}: code=${code} (${ms}ms)`),
					{ signal: ctrl.signal, spawn: deps.spawn, sleep: deps.sleep },
				);
				journal.steps.push({
					kind: 'confirm-asleep',
					ok: result.ok,
					attempts: result.attempts,
					totalMs: result.totalMs,
				});
				if (!result.ok) {
					throw new SleepError(
						EXIT.SLEEP_NOT_CONFIRMED,
						`host still reachable after ${opts.timeout}s — sleep may have been blocked`,
					);
				}
				log.verbose(
					`  asleep after ${Math.round(result.totalMs / 1000)}s, ${result.attempts} probe(s)`,
				);
				break;
			}

			default:
				throw new Error(`Unknown step kind: ${step.kind}`);
		}
	}
}
