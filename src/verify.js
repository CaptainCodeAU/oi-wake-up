import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { isValidMAC, wake } from './index.js';
import { spawnSsh } from './spawn.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MODE_FLAGS = ['force', 'wakeOnly', 'noRestart', 'noWake', 'dryRun', 'status'];
const MODE_FLAG_DISPLAY = {
	force: '--force',
	wakeOnly: '--wake-only',
	noRestart: '--no-restart',
	noWake: '--no-wake',
	dryRun: '--dry-run',
	status: '--status',
};

const LEVELS = { quiet: 0, default: 1, verbose: 2, debug: 3 };

// SSH hardening defaults for the remediate/verify command channels (NOT the
// probe, and NOT oi-wake-down's sleep channel — those are deliberately left
// alone). Without ConnectTimeout, a stalled TCP connect rides OpenSSH's
// default (~the kernel SYN budget, ~120s) and an external caller's timeout is
// the only thing that stops it. ServerAlive catches a channel that goes silent
// mid-command (e.g. a half-open connection after a flaky post-wake window).
const REMOTE_CONNECT_TIMEOUT_S = 10; // fast-fail a stalled connect -> caller can buffer + retry
const SERVER_ALIVE_INTERVAL_S = 5; // probe a quiet channel every 5s...
const SERVER_ALIVE_COUNT_MAX = 3; // ...give up after 3 misses (~15s)

// Read-only wake-source query for --capture-wake-source. Full interop path
// (like oi-wake-down's rundll32) because SSH lands in WSL bash where bare
// `powercfg` is not on PATH. /lastwake is read-only — never mutates power
// policy (Decision #19). Windows/WSL-only; on any other target the command
// fails and the capture is recorded as not-captured (never fatal).
const DEFAULT_WAKE_SOURCE_CMD = '/mnt/c/Windows/System32/powercfg.exe /lastwake';

/**
 * Read this package's version from package.json next to the repo root.
 * @returns {string}
 */
export function getVersion() {
	const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
	return pkg.version;
}

/**
 * Help text for `oi-wake-verify --help`.
 * Kept in this module so it stays close to the parser.
 */
export const HELP_TEXT = `Usage: oi-wake-verify <host> [options]

Wake a machine via WoL, wait for SSH, run remediation. Idempotent — does
nothing if the host is already reachable, unless --force.

Required:
  <host>                    Hostname or IP of the target

Wake parameters:
  -m, --mac <mac>           Target MAC address (required unless --no-wake)
  -b, --broadcast <ip>      WoL broadcast address (default: 255.255.255.255)
  -p, --port <number>       WoL UDP port (default: 9)

SSH parameters:
  -u, --user <user>         SSH user (default: ssh's resolution — User
                            from ~/.ssh/config Host block, else $USER)
      --ssh-port <number>   SSH port (default: 22)
  -i, --identity <path>     SSH identity file (default: ssh's default)
      --ssh-opt <opt>       Pass-through SSH option, repeatable
                            (e.g. --ssh-opt StrictHostKeyChecking=accept-new)
  -F, --ssh-config <path>   Pass an explicit ssh config file (ssh -F <path>);
                            for contexts where ~/.ssh/config is unreadable

Remediation:
  -r, --remediate <cmd>     Command to run on host after wake
  -V, --verify <cmd>        Optional post-remediation health check (exit 0 = ok)
      --remediate-timeout <s>  Kill --remediate if it runs longer than <s> (0 = no cap, default)
      --verify-timeout <s>     Kill --verify if it runs longer than <s> (0 = no cap, default)
  -g, --grace <seconds>     Wait after SSH up before remediation (default: 10)
      --capture-verify      Include --remediate/--verify stdout+stderr in --json/--journal records

Mode flags (mutually exclusive):
  -f, --force               Run remediation even if already awake
      --wake-only           Send magic packet only; skip SSH & remediation
      --no-restart          Wake & wait for SSH; skip remediation
      --no-wake             Skip wake; just probe + remediate
      --status              Probe SSH and report reachable/unreachable; no
                            wake/remediate; exit 0 even when unreachable
  -n, --dry-run             Print planned actions; perform none

Polling:
  -t, --timeout <seconds>   Total wake timeout (default: 180)
      --poll <seconds>      SSH poll interval (default: 3)
      --probe-timeout <s>   Initial SSH-probe ConnectTimeout (default: 2)
      --retry-wake <n>      Re-send magic packet if SSH times out; retry up to N times (default: 0)

Safety:
      --max-output <bytes>  Truncate captured stdout+stderr at this size (default: 1048576)

Output:
  -q, --quiet               Errors only
  -v, --verbose             Per-step detail + timings
  -d, --debug               Full SSH transcripts and resolved options
      --json                Structured JSON to stdout (overrides verbosity)
      --journal <path>      Append JSON journal entry to file (JSONL; one object per line)
      --capture-wake-source After a wake, capture read-only powercfg /lastwake
                            into the journal's wakeSource field (Windows/WSL)

Standard:
  -h, --help                Show this help
      --version             Show version

Note: -d here means debug. The sibling tool (oi-wake-up) uses -d for delay.`;

/**
 * @typedef {Object} VerifyOptions
 * @property {string} host
 * @property {string|null} mac
 * @property {string} broadcast
 * @property {number} port
 * @property {string|null} user
 * @property {number} sshPort
 * @property {string|null} identity
 * @property {string[]} sshOpts
 * @property {string|null} sshConfig
 * @property {string|null} remediate
 * @property {string|null} verifyCmd
 * @property {number} remediateTimeout
 * @property {number} verifyTimeout
 * @property {number} grace
 * @property {boolean} captureVerify
 * @property {boolean} force
 * @property {boolean} wakeOnly
 * @property {boolean} noRestart
 * @property {boolean} noWake
 * @property {boolean} dryRun
 * @property {boolean} status
 * @property {number} timeout
 * @property {number} poll
 * @property {number} probeTimeout
 * @property {number} maxOutput
 * @property {boolean} captureWakeSource
 * @property {number} retryWake
 * @property {'quiet'|'default'|'verbose'|'debug'} level
 * @property {boolean} json
 * @property {string|null} journal
 * @property {boolean} help
 * @property {boolean} version
 */

/**
 * Parse process.argv-style arguments into a VerifyOptions object.
 * Throws Error on validation failure (unknown flag, missing required,
 * conflicting mode flags, invalid MAC, NaN/out-of-range numerics).
 * @param {string[]} argv
 * @returns {VerifyOptions}
 */
export function parseVerifyArgs(argv) {
	/** @type {VerifyOptions} */
	const opts = {
		host: '',
		mac: null,
		broadcast: '255.255.255.255',
		port: 9,
		user: null,
		sshPort: 22,
		identity: null,
		sshOpts: [],
		sshConfig: null,
		remediate: null,
		verifyCmd: null,
		remediateTimeout: 0,
		verifyTimeout: 0,
		grace: 10,
		captureVerify: false,
		force: false,
		wakeOnly: false,
		noRestart: false,
		noWake: false,
		dryRun: false,
		status: false,
		timeout: 180,
		poll: 3,
		probeTimeout: 2,
		maxOutput: 1048576,
		captureWakeSource: false,
		retryWake: 0,
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
			case '-m':
			case '--mac':
				opts.mac = requireValue(argv, ++i, arg);
				break;
			case '-b':
			case '--broadcast':
				opts.broadcast = requireValue(argv, ++i, arg);
				break;
			case '-p':
			case '--port':
				opts.port = parsePort(requireValue(argv, ++i, arg), arg);
				break;
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
			case '-r':
			case '--remediate':
				opts.remediate = requireValue(argv, ++i, arg);
				break;
			case '-V':
			case '--verify':
				opts.verifyCmd = requireValue(argv, ++i, arg);
				break;
			case '--remediate-timeout':
				opts.remediateTimeout = parseNonNegativeInt(requireValue(argv, ++i, arg), arg);
				break;
			case '--verify-timeout':
				opts.verifyTimeout = parseNonNegativeInt(requireValue(argv, ++i, arg), arg);
				break;
			case '-g':
			case '--grace':
				opts.grace = parseNonNegativeInt(requireValue(argv, ++i, arg), arg);
				break;
			case '--capture-verify':
				opts.captureVerify = true;
				break;
			case '--capture-wake-source':
				opts.captureWakeSource = true;
				break;
			case '-f':
			case '--force':
				opts.force = true;
				break;
			case '--wake-only':
				opts.wakeOnly = true;
				break;
			case '--no-restart':
				opts.noRestart = true;
				break;
			case '--no-wake':
				opts.noWake = true;
				break;
			case '--status':
				opts.status = true;
				break;
			case '-n':
			case '--dry-run':
				opts.dryRun = true;
				break;
			case '-t':
			case '--timeout':
				opts.timeout = parsePositiveInt(requireValue(argv, ++i, arg), arg);
				break;
			case '--poll':
				opts.poll = parsePositiveInt(requireValue(argv, ++i, arg), arg);
				break;
			case '--probe-timeout':
				opts.probeTimeout = parsePositiveInt(requireValue(argv, ++i, arg), arg);
				break;
			case '--retry-wake':
				opts.retryWake = parseNonNegativeInt(requireValue(argv, ++i, arg), arg);
				break;
			case '--max-output':
				opts.maxOutput = parsePositiveInt(requireValue(argv, ++i, arg), arg);
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

	const setModes = MODE_FLAGS.filter((k) => opts[k]);
	if (setModes.length > 1) {
		const names = setModes.map((k) => MODE_FLAG_DISPLAY[k]).join(', ');
		throw new Error(`Conflicting mode flags: ${names} are mutually exclusive`);
	}

	if (!opts.noWake && !opts.status && !opts.mac) {
		throw new Error('Missing required option: --mac (omit only with --no-wake / --status)');
	}

	if (opts.mac && !isValidMAC(opts.mac)) {
		throw new Error(`Invalid MAC address: ${opts.mac}`);
	}

	return opts;
}

function requireValue(argv, i, flag) {
	const v = argv[i];
	if (v === undefined) {
		throw new Error(`${flag} requires a value`);
	}
	return v;
}

function parsePort(value, flag) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || String(n) !== String(value).replace(/^\+/, '')) {
		throw new Error(`${flag}: invalid number: ${value}`);
	}
	if (n < 0 || n > 65535) {
		throw new Error(`${flag}: port out of range: ${value}`);
	}
	return n;
}

function parsePositiveInt(value, flag) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || String(n) !== String(value).replace(/^\+/, '')) {
		throw new Error(`${flag}: invalid number: ${value}`);
	}
	if (n <= 0) {
		throw new Error(`${flag}: must be positive: ${value}`);
	}
	return n;
}

function parseNonNegativeInt(value, flag) {
	const n = Number.parseInt(value, 10);
	if (!Number.isFinite(n) || String(n) !== String(value).replace(/^\+/, '')) {
		throw new Error(`${flag}: invalid number: ${value}`);
	}
	if (n < 0) {
		throw new Error(`${flag}: must be non-negative: ${value}`);
	}
	return n;
}

/**
 * @typedef {Object} ModeFlags
 * @property {boolean} [force]
 * @property {boolean} [wakeOnly]
 * @property {boolean} [noRestart]
 * @property {boolean} [noWake]
 * @property {boolean} [dryRun]
 */

/**
 * @typedef {Object} ActionStep
 * @property {'wake'|'wait'|'grace'|'remediate'|'verify'|'noop'|'abort'} kind
 * @property {string} [reason]
 * @property {number} [exitCode]
 */

/**
 * Pure state-machine: given the SSH-probe outcome and mode flags,
 * return the ordered list of steps the executor should perform.
 *
 * @param {'reachable'|'unreachable'} state
 * @param {ModeFlags} flags
 * @returns {ActionStep[]}
 */
export function decideAction(state, flags = {}) {
	if (flags.dryRun) {
		// Dry-run prints both branches; the executor renders the message.
		return [{ kind: 'noop', reason: 'dry-run' }];
	}

	if (state === 'reachable') {
		if (flags.force) return [{ kind: 'remediate' }, { kind: 'grace' }, { kind: 'verify' }];
		if (flags.noWake) return [{ kind: 'remediate' }, { kind: 'grace' }, { kind: 'verify' }];
		if (flags.wakeOnly) return [{ kind: 'noop', reason: 'already awake — wake skipped' }];
		if (flags.noRestart) return [{ kind: 'noop', reason: 'already awake — nothing to do' }];
		return [{ kind: 'noop', reason: 'already awake — no action' }];
	}

	// unreachable
	if (flags.noWake) {
		return [{ kind: 'abort', exitCode: 3, reason: 'host unreachable and --no-wake set' }];
	}
	if (flags.wakeOnly) return [{ kind: 'wake' }];
	if (flags.noRestart) return [{ kind: 'wake' }, { kind: 'wait' }];
	// default + force — grace appears twice (after SSH up; after remediate)
	// because both are state transitions that need time to settle.
	return [
		{ kind: 'wake' },
		{ kind: 'wait' },
		{ kind: 'grace' },
		{ kind: 'remediate' },
		{ kind: 'grace' },
		{ kind: 'verify' },
	];
}

/**
 * @typedef {Object} Logger
 * @property {(n: number, total: number, msg: string) => void} step
 * @property {(msg: string) => void} info
 * @property {(msg: string) => void} verbose
 * @property {(msg: string) => void} debug
 * @property {(msg: string) => void} error
 * @property {(obj: object) => void} json
 */

/**
 * Build a logger that respects the requested verbosity tier and json mode.
 *
 * Without --json: step/info/verbose/debug go to stdout when level allows;
 * errors always go to stderr.
 *
 * With --json: stdout receives only the final JSON object emitted via
 * `json()`. step/info/verbose/debug are redirected to stderr (still
 * respecting level) so progress is observable but doesn't pollute stdout.
 *
 * @param {'quiet'|'default'|'verbose'|'debug'} level
 * @param {boolean} json
 * @param {{stdout?: (s: string) => void, stderr?: (s: string) => void}} [streams]
 * @returns {Logger}
 */
export function createLogger(level, json, streams = {}) {
	const lvl = LEVELS[level] ?? LEVELS.default;
	const out = streams.stdout ?? ((s) => process.stdout.write(s + '\n'));
	const err = streams.stderr ?? ((s) => process.stderr.write(s + '\n'));

	const writeProgress = json ? err : out;

	return {
		step(n, total, msg) {
			if (lvl >= LEVELS.default) writeProgress(`[${n}/${total}] ${msg}`);
		},
		info(msg) {
			if (lvl >= LEVELS.default) writeProgress(msg);
		},
		verbose(msg) {
			if (lvl >= LEVELS.verbose) writeProgress(msg);
		},
		debug(msg) {
			if (lvl >= LEVELS.debug) writeProgress(msg);
		},
		error(msg) {
			err(msg);
		},
		json(obj) {
			if (json) out(JSON.stringify(obj));
		},
	};
}

/**
 * Build the argument list `ssh` should be invoked with, given options.
 * Pure — returned for both real spawning and assertions in tests.
 *
 * @param {VerifyOptions} opts
 * @param {{ batchMode?: boolean, connectTimeout?: number, serverAliveInterval?: number, serverAliveCountMax?: number, remoteCommand?: string|null }} [extra]
 * @returns {string[]}
 */
export function buildSshArgs(opts, extra = {}) {
	const args = [];

	if (extra.batchMode !== false) {
		args.push('-o', 'BatchMode=yes');
	}
	// An explicit -F config must precede the target so ssh applies it when
	// resolving the host alias (the ProtectHome/cron case where ~/.ssh/config
	// is unreadable). Applies to probe, remediate, verify, and wake-source.
	if (opts.sshConfig) {
		args.push('-F', opts.sshConfig);
	}
	if (typeof extra.connectTimeout === 'number') {
		args.push('-o', `ConnectTimeout=${extra.connectTimeout}`);
	}
	if (typeof extra.serverAliveInterval === 'number') {
		args.push('-o', `ServerAliveInterval=${extra.serverAliveInterval}`);
	}
	if (typeof extra.serverAliveCountMax === 'number') {
		args.push('-o', `ServerAliveCountMax=${extra.serverAliveCountMax}`);
	}

	if (opts.identity) {
		args.push('-i', opts.identity);
	}
	if (opts.sshPort && opts.sshPort !== 22) {
		args.push('-p', String(opts.sshPort));
	}
	for (const o of opts.sshOpts) {
		args.push('-o', o);
	}

	const target = opts.user ? `${opts.user}@${opts.host}` : opts.host;
	args.push(target);

	if (extra.remoteCommand) {
		args.push(extra.remoteCommand);
	}

	return args;
}

/**
 * Parse the stdout of `powercfg /lastwake` into a structured wake-source object.
 *
 * Pure and total — never throws. It only interprets text; the SSH/exec failure
 * path is handled by the caller. Tolerant of formatting variance across Windows
 * builds: a key/value line may use `Key: Value` or `Key - Value`, and a blank
 * value (e.g. an empty `Friendly Name:`) becomes null. Unrecognized output
 * falls back to `{ type: 'unknown' }` with the verbatim `raw` retained so a
 * downstream consumer can reparse — the feature never silently lies.
 *
 * Output (the caller wraps these with performedWake/captured):
 *   - Device / Power Button / Fixed Feature / Wake Timer / ...:
 *       { type:<value>, instancePath, friendlyName, description, manufacturer }
 *   - No history (`Wake History Count - 0`): { type:'none', none:true }
 *   - Unrecognized: { type:'unknown' }
 * `raw` (verbatim input) is always included.
 *
 * @param {string} raw
 * @returns {{type:string, none?:boolean, instancePath?:string|null, friendlyName?:string|null, description?:string|null, manufacturer?:string|null, raw:string}}
 */
export function parseWakeSource(raw) {
	const text = typeof raw === 'string' ? raw : '';

	// No wake history recorded — not an error, just nothing to attribute.
	if (/Wake History Count\s*[-:]\s*0\b/i.test(text)) {
		return { type: 'none', none: true, raw: text };
	}

	// Collect "Key: Value" / "Key - Value" pairs (last occurrence wins). The key
	// is letters+spaces only, so "Wake Source [0]" / "Wake History [0]" headers
	// (no separator) are skipped and instance-path backslashes never confuse it.
	const fields = {};
	for (const line of text.split('\n')) {
		const m = line.trim().match(/^([A-Za-z][A-Za-z ]+?)\s*[:\-]\s*(.*)$/);
		if (m) {
			const key = m[1].trim().toLowerCase();
			const value = m[2].trim();
			fields[key] = value === '' ? null : value;
		}
	}

	const type = fields['type'];
	if (!type) {
		return { type: 'unknown', raw: text };
	}

	return {
		type,
		instancePath: fields['instance path'] ?? null,
		friendlyName: fields['friendly name'] ?? null,
		description: fields['description'] ?? null,
		manufacturer: fields['manufacturer'] ?? null,
		raw: text,
	};
}

/**
 * Run the read-only `powercfg /lastwake` query over the post-wake SSH channel
 * and return a journal `wakeSource` record. NEVER throws and NEVER changes the
 * run's exit code — a capture failure (non-Windows target, powercfg missing,
 * permission, dropped channel) is recorded as `{ captured: false, ... }`.
 * Only called after a successful post-wake `wait`, so `performedWake` is true.
 *
 * @param {VerifyOptions} opts
 * @param {{spawn?: typeof spawnSsh, signal?: AbortSignal}} [deps]
 * @returns {Promise<object>}
 */
async function captureWakeSourceRecord(opts, deps = {}) {
	try {
		const r = await runRemote(opts, DEFAULT_WAKE_SOURCE_CMD, {
			signal: deps.signal,
			spawn: deps.spawn,
			maxBuffer: opts.maxOutput,
			connectTimeout: REMOTE_CONNECT_TIMEOUT_S,
			serverAliveInterval: SERVER_ALIVE_INTERVAL_S,
			serverAliveCountMax: SERVER_ALIVE_COUNT_MAX,
		});
		if (r.code !== 0) {
			return {
				performedWake: true,
				captured: false,
				error: r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`,
				reason: `powercfg /lastwake failed (exit ${r.code})`,
			};
		}
		return { performedWake: true, captured: true, ...parseWakeSource(r.stdout) };
	} catch (err) {
		return {
			performedWake: true,
			captured: false,
			error: err?.message ?? String(err),
			reason: 'powercfg /lastwake could not run',
		};
	}
}

// ---------------------------------------------------------------------------
// Orchestrator pieces (real I/O — exercised in Layer 2 against spawn-fake).
// ---------------------------------------------------------------------------

/**
 * Probe SSH reachability with a short ConnectTimeout. Reachable iff exit 0.
 *
 * @param {VerifyOptions} opts
 * @param {{spawn?: typeof spawnSsh, signal?: AbortSignal}} [deps]
 * @returns {Promise<{reachable: boolean, code: number, stderr: string, durationMs: number}>}
 */
export async function probeSsh(opts, deps = {}) {
	const spawnFn = deps.spawn ?? spawnSsh;
	const args = buildSshArgs(opts, {
		batchMode: true,
		connectTimeout: opts.probeTimeout,
		remoteCommand: 'true',
	});
	const result = await spawnFn(args, { signal: deps.signal });
	return {
		reachable: result.code === 0,
		code: result.code,
		stderr: result.stderr,
		durationMs: result.durationMs,
	};
}

/**
 * Poll `probeSsh` until it succeeds or the total timeout elapses.
 *
 * @param {VerifyOptions} opts
 * @param {(attempt: number, code: number, durationMs: number) => void} [onProgress]
 * @param {{spawn?: typeof spawnSsh, signal?: AbortSignal, sleep?: (ms: number) => Promise<void>}} [deps]
 * @returns {Promise<{ok: boolean, attempts: number, totalMs: number}>}
 */
export async function pollUntilReachable(opts, onProgress, deps = {}) {
	const spawnFn = deps.spawn ?? spawnSsh;
	const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const start = Date.now();
	const deadline = start + opts.timeout * 1000;
	let attempts = 0;

	while (Date.now() < deadline) {
		if (deps.signal?.aborted) {
			return { ok: false, attempts, totalMs: Date.now() - start };
		}
		attempts++;
		const result = await probeSsh(opts, { spawn: spawnFn, signal: deps.signal });
		if (onProgress) onProgress(attempts, result.code, result.durationMs);
		if (result.reachable) {
			return { ok: true, attempts, totalMs: Date.now() - start };
		}
		if (Date.now() + opts.poll * 1000 >= deadline) break;
		await sleep(opts.poll * 1000);
	}

	return { ok: false, attempts, totalMs: Date.now() - start };
}

/**
 * Run a remote command via SSH and capture both streams.
 *
 * Hardening (connectTimeout, serverAlive, timeoutMs) is opt-in per call so the
 * probe and oi-wake-down's sleep channel keep their existing behaviour — only
 * oi-wake-verify's remediate/verify steps pass them.
 *
 * @param {VerifyOptions} opts
 * @param {string} command
 * @param {{spawn?: typeof spawnSsh, signal?: AbortSignal, maxBuffer?: number, timeoutMs?: number, connectTimeout?: number, serverAliveInterval?: number, serverAliveCountMax?: number}} [deps]
 * @returns {Promise<{code: number, stdout: string, stderr: string, durationMs: number, killed: boolean, signal: string|null}>}
 */
export async function runRemote(opts, command, deps = {}) {
	const spawnFn = deps.spawn ?? spawnSsh;
	const args = buildSshArgs(opts, {
		batchMode: true,
		connectTimeout: deps.connectTimeout,
		serverAliveInterval: deps.serverAliveInterval,
		serverAliveCountMax: deps.serverAliveCountMax,
		remoteCommand: command,
	});
	return spawnFn(args, { signal: deps.signal, maxBuffer: deps.maxBuffer, timeoutMs: deps.timeoutMs });
}

/**
 * Send a Wake-on-LAN magic packet to the configured broadcast address.
 * Thin wrapper so the orchestrator can be stubbed in tests.
 *
 * @param {VerifyOptions} opts
 * @param {{wake?: typeof wake}} [deps]
 * @returns {Promise<void>}
 */
export async function sendWake(opts, deps = {}) {
	if (!opts.mac) throw new Error('sendWake called without --mac');
	const wakeFn = deps.wake ?? wake;
	await wakeFn(opts.mac, { address: opts.broadcast, port: opts.port });
}

// ---------------------------------------------------------------------------
// Shared internals
// ---------------------------------------------------------------------------

function sleep(ms, signal) {
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

// ---------------------------------------------------------------------------
// VerifyError — carries exit code through the async call stack
// ---------------------------------------------------------------------------

export class VerifyError extends Error {
	constructor(exitCode, message) {
		super(message);
		this.exitCode = exitCode;
	}
}

// ---------------------------------------------------------------------------
// EXIT — stable exit-code contract (documented in README)
// ---------------------------------------------------------------------------

export const EXIT = {
	OK: 0,
	MISCONFIG: 1,
	WAKE_FAILED: 2,
	SSH_TIMEOUT: 3,
	REMEDIATION_FAILED: 4,
	VERIFY_FAILED: 5,
	USAGE: 64,
	INTERRUPTED: 130,
};

// ---------------------------------------------------------------------------
// executePlan — step dispatcher; exported so library consumers get the pipeline
// ---------------------------------------------------------------------------

/**
 * Execute an ordered list of steps returned by decideAction.
 *
 * @param {ActionStep[]} plan
 * @param {VerifyOptions} opts
 * @param {{ log: Logger, journal: object, total: number, ctrl: AbortController }} ctx
 * @param {{ spawn?: typeof spawnSsh, wake?: Function, sleep?: Function }} [deps]
 * @returns {Promise<void>}
 */
export async function executePlan(plan, opts, ctx, deps = {}) {
	const { log, journal, total, ctrl } = ctx;
	const sleepFn = deps.sleep ?? sleep;
	let stepNum = 1; // 1 was the probe itself

	for (const step of plan) {
		stepNum++;
		switch (step.kind) {
			case 'noop':
				log.step(stepNum, total, step.reason ?? 'no-op');
				journal.steps.push({ kind: 'noop', reason: step.reason });
				return;

			case 'abort':
				journal.steps.push({ kind: 'abort', reason: step.reason });
				throw new VerifyError(step.exitCode, step.reason);

			case 'wake':
				log.step(stepNum, total, `Sending magic packet to ${opts.mac} via ${opts.broadcast}:${opts.port}`);
				try {
					await sendWake(opts, { wake: deps.wake });
					journal.steps.push({ kind: 'wake', ok: true });
				} catch (err) {
					journal.steps.push({ kind: 'wake', ok: false, error: err.message });
					throw new VerifyError(EXIT.WAKE_FAILED, `wake failed: ${err.message}`);
				}
				break;

			case 'wait': {
				log.step(stepNum, total, `Waiting for SSH (timeout=${opts.timeout}s, poll=${opts.poll}s)...`);
				let lastResult = { ok: false, attempts: 0, totalMs: 0 };
				for (let retry = 0; retry <= opts.retryWake; retry++) {
					if (retry > 0) {
						log.info(`  SSH timeout — re-sending magic packet (retry ${retry}/${opts.retryWake})`);
						try { await sendWake(opts, { wake: deps.wake }); } catch { /* best-effort */ }
					}
					lastResult = await pollUntilReachable(
						opts,
						(attempt, code, ms) => log.verbose(`  attempt ${attempt}: code=${code} (${ms}ms)`),
						{ signal: ctrl.signal, spawn: deps.spawn, sleep: deps.sleep },
					);
					if (lastResult.ok) break;
				}
				journal.steps.push({
					kind: 'wait',
					ok: lastResult.ok,
					attempts: lastResult.attempts,
					totalMs: lastResult.totalMs,
				});
				if (!lastResult.ok) {
					throw new VerifyError(
						EXIT.SSH_TIMEOUT,
						`SSH never came up within ${opts.timeout}s (${lastResult.attempts} attempts)`,
					);
				}
				log.verbose(`  SSH up after ${Math.round(lastResult.totalMs / 1000)}s, ${lastResult.attempts} attempts`);
				// Read-only wake-source capture (opt-in). Runs here — as soon as
				// SSH is up and BEFORE remediate restarts anything — so powercfg
				// /lastwake still reflects this run's wake. Never fatal; top-level
				// journal.wakeSource, not a step (no step-count drift).
				if (opts.captureWakeSource) {
					log.verbose('  Capturing wake source (powercfg /lastwake)...');
					journal.wakeSource = await captureWakeSourceRecord(opts, { spawn: deps.spawn, signal: ctrl.signal });
				}
				break;
			}

			case 'grace':
				if (opts.grace > 0) {
					log.step(stepNum, total, `Grace ${opts.grace}s to settle`);
					await sleepFn(opts.grace * 1000, ctrl.signal);
					journal.steps.push({ kind: 'grace', seconds: opts.grace });
				} else {
					stepNum--;
				}
				break;

			case 'remediate':
				if (!opts.remediate) {
					stepNum--;
					continue;
				}
				log.step(stepNum, total, `Running remediation: ${opts.remediate}`);
				{
					const timeoutMs = opts.remediateTimeout > 0 ? opts.remediateTimeout * 1000 : undefined;
					const r = await runRemote(opts, opts.remediate, {
						signal: ctrl.signal,
						spawn: deps.spawn,
						maxBuffer: opts.maxOutput,
						timeoutMs,
						connectTimeout: REMOTE_CONNECT_TIMEOUT_S,
						serverAliveInterval: SERVER_ALIVE_INTERVAL_S,
						serverAliveCountMax: SERVER_ALIVE_COUNT_MAX,
					});
					log.debug(`remediate: code=${r.code} stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`);
					const remediateStep = { kind: 'remediate', code: r.code, durationMs: r.durationMs, killed: r.killed };
					if (opts.captureVerify) {
						remediateStep.stdout = r.stdout;
						remediateStep.stderr = r.stderr;
					}
					journal.steps.push(remediateStep);
					if (timeoutMs && r.killed) {
						throw new VerifyError(
							EXIT.REMEDIATION_FAILED,
							`remediation timed out after ${opts.remediateTimeout}s`,
						);
					}
					if (r.code !== 0) {
						throw new VerifyError(
							EXIT.REMEDIATION_FAILED,
							`remediation failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`,
						);
					}
				}
				break;

			case 'verify':
				if (!opts.verifyCmd) {
					stepNum--;
					continue;
				}
				log.step(stepNum, total, `Verifying: ${opts.verifyCmd}`);
				{
					const timeoutMs = opts.verifyTimeout > 0 ? opts.verifyTimeout * 1000 : undefined;
					const r = await runRemote(opts, opts.verifyCmd, {
						signal: ctrl.signal,
						spawn: deps.spawn,
						maxBuffer: opts.maxOutput,
						timeoutMs,
						connectTimeout: REMOTE_CONNECT_TIMEOUT_S,
						serverAliveInterval: SERVER_ALIVE_INTERVAL_S,
						serverAliveCountMax: SERVER_ALIVE_COUNT_MAX,
					});
					log.debug(`verify: code=${r.code} stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`);
					const verifyStep = { kind: 'verify', code: r.code, durationMs: r.durationMs, killed: r.killed };
					if (opts.captureVerify) {
						verifyStep.stdout = r.stdout;
						verifyStep.stderr = r.stderr;
					}
					journal.steps.push(verifyStep);
					if (timeoutMs && r.killed) {
						throw new VerifyError(
							EXIT.VERIFY_FAILED,
							`verification timed out after ${opts.verifyTimeout}s`,
						);
					}
					if (r.code !== 0) {
						throw new VerifyError(
							EXIT.VERIFY_FAILED,
							`verification failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`,
						);
					}
				}
				break;

			default:
				throw new Error(`Unknown step kind: ${step.kind}`);
		}
	}
}
