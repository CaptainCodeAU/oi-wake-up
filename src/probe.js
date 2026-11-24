import { accessSync, statSync, existsSync, constants as FS } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Why a probe did not answer, sorted from ssh's exit code and stderr (v1.6.0).
 *
 * Kinds:
 *   reachable        exit 0
 *   auth_refused     the host answered but refused the login       -> exit 8
 *   hostkey_missing  no known_hosts line for the host (BatchMode)  -> exit 9
 *   hostkey_changed  the host's key differs from known_hosts       -> exit 9
 *   sandbox_blocked  ~/.ssh cannot be read, though its mode allows -> exit 1
 *   ssh_permissions  a plain permissions fault on ~/.ssh           -> exit 1
 *   unreachable      timed out / no route / host down / refused connection
 *   unknown          anything else; keeps the pre-1.6.0 unreachable path
 *
 * The stop kinds end a run at once: never retried, never waited out, never
 * re-woken, and oi-wake-down never reads them as "already asleep".
 */

export const STOP_KINDS = new Set([
	'auth_refused',
	'hostkey_missing',
	'hostkey_changed',
	'sandbox_blocked',
	'ssh_permissions',
]);

/** Exit numbers shared by both tools; verify.js and sleep.js spread these in. */
export const SHARED_EXIT = {
	OK: 0,
	MISCONFIG: 1,
	AUTH_REFUSED: 8,
	HOSTKEY_FAILED: 9,
	USAGE: 64,
	INTERRUPTED: 130,
};

/**
 * @param {string} kind
 * @returns {number|null} exit code for a stop kind, else null
 */
export function exitForKind(kind) {
	switch (kind) {
		case 'auth_refused':
			return SHARED_EXIT.AUTH_REFUSED;
		case 'hostkey_missing':
		case 'hostkey_changed':
			return SHARED_EXIT.HOSTKEY_FAILED;
		case 'sandbox_blocked':
		case 'ssh_permissions':
			return SHARED_EXIT.MISCONFIG;
		default:
			return null;
	}
}

const SSH_READ_FAILURE = /\.ssh\/\S*:? (operation not permitted|permission denied)(?! \()|bad owner or permissions on/i;
const HOSTKEY_CHANGED = /remote host identification has changed|host key for .* has changed|possible dns spoofing/i;
const HOSTKEY_MISSING = /host key verification failed|no \S+ host key is known for/i;
const AUTH_REFUSED = /permission denied \(|too many authentication failures/i;
const UNREACHABLE = /timed out|no route to host|host is down|connection refused|network is unreachable/i;

/**
 * Sort one spawn result into a kind. Order matters: a read failure under
 * ~/.ssh is checked before auth (both can say "Permission denied"), and the
 * changed-key banner before the bare "Host key verification failed".
 *
 * @param {{code: number, stderr?: string}} result
 * @param {{check?: () => string}} [deps] check: decides sandbox_blocked vs ssh_permissions
 * @returns {{kind: string}}
 */
export function classifyProbe(result, deps = {}) {
	if (result.code === 0) return { kind: 'reachable' };
	if (result.code !== 255) return { kind: 'unknown' };
	const stderr = result.stderr ?? '';
	if (SSH_READ_FAILURE.test(stderr)) {
		const check = deps.check ?? (() => checkSshPermissions());
		return { kind: check() };
	}
	if (HOSTKEY_CHANGED.test(stderr)) return { kind: 'hostkey_changed' };
	if (HOSTKEY_MISSING.test(stderr)) return { kind: 'hostkey_missing' };
	if (AUTH_REFUSED.test(stderr)) return { kind: 'auth_refused' };
	if (UNREACHABLE.test(stderr)) return { kind: 'unreachable' };
	return { kind: 'unknown' };
}

/**
 * Name the sandbox only when ~/.ssh/known_hosts cannot be read while its mode
 * allows this user (Network_Plan-main's call). Otherwise a plain permissions fault.
 *
 * @param {{home?: string, uid?: number, gid?: number, access?: Function, stat?: Function}} [deps]
 * @returns {'sandbox_blocked'|'ssh_permissions'}
 */
export function checkSshPermissions(deps = {}) {
	const home = deps.home ?? homedir();
	const uid = deps.uid ?? process.getuid?.();
	const gid = deps.gid ?? process.getgid?.();
	const access = deps.access ?? ((p) => accessSync(p, FS.R_OK));
	const stat = deps.stat ?? statSync;
	const kh = join(home, '.ssh', 'known_hosts');
	try {
		access(kh);
		return 'ssh_permissions';
	} catch {
		// unreadable: does the mode say it should be readable?
	}
	let st;
	try {
		st = stat(kh);
	} catch {
		return 'ssh_permissions';
	}
	const mode = st.mode;
	let allows;
	if (st.uid === uid) allows = (mode & 0o400) !== 0;
	else if (st.gid === gid) allows = (mode & 0o040) !== 0;
	else allows = (mode & 0o004) !== 0;
	return allows ? 'sandbox_blocked' : 'ssh_permissions';
}

/**
 * The first meaningful stderr line, safe for --json and the journal: blank and
 * @@@ banner lines skipped; $HOME -> ~; fingerprints, key blobs and Load key
 * paths replaced by [redacted].
 *
 * @param {string|undefined} stderr
 * @param {{home?: string}} [opts]
 * @returns {string}
 */
export function firstStderrLine(stderr, opts = {}) {
	if (typeof stderr !== 'string' || !stderr) return '';
	const home = opts.home ?? homedir();
	const line = stderr
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l && !/^@+$/.test(l));
	if (!line) return '';
	return redact(line, home);
}

function redact(s, home) {
	let out = s;
	out = out.replace(/Load key "[^"]*"/g, 'Load key "[redacted]"');
	out = out.replace(/SHA256:[A-Za-z0-9+/=]+/g, 'SHA256:[redacted]');
	out = out.replace(/MD5:(?:[0-9a-f]{2}:){15}[0-9a-f]{2}/gi, 'MD5:[redacted]');
	out = out.replace(/AAAA[A-Za-z0-9+/=]{16,}/g, '[redacted]');
	if (home && home !== '/') out = out.split(home).join('~');
	return out;
}

function defaultExec(cmd, args, opts = {}) {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: 5000, env: opts.env ?? process.env }, (err, stdout, stderr) => {
			if (err && typeof err.code !== 'number') {
				resolve({ code: 127, stdout: '', stderr: String(err.message) });
				return;
			}
			resolve({ code: err ? err.code : 0, stdout: String(stdout), stderr: String(stderr) });
		});
	});
}

function expandHome(p, home) {
	if (p === '~') return home;
	if (p.startsWith('~/')) return join(home, p.slice(2));
	return p;
}

/** Second field of each `<bits> <fingerprint> <comment> (<type>)` line. */
function fingerprints(listing) {
	return listing
		.split('\n')
		.map((l) => l.trim().split(/\s+/)[1])
		.filter((f) => f && /^(SHA256|MD5):/.test(f));
}

/**
 * Why a login was refused, for the human message and the JSON (item 5,
 * Network_Plan-main's security calls). Only ssh-add's exit code and a count
 * leave this function; the listing and every fingerprint stay in memory here.
 * The private key file is never read: only <IdentityFile>.pub reaches
 * ssh-keygen. Never throws.
 *
 * @param {{host: string, user?: string|null, sshPort?: number, identity?: string|null, sshOpts?: string[], sshConfig?: string|null}} opts
 * @param {{exec?: Function, home?: string, exists?: (p: string) => boolean}} [deps]
 * @returns {Promise<{auth: {agent: string, keyCount: number|null, matchingKeyLoaded: boolean|null}, identityFiles: string[]}>}
 */
export async function diagnoseAuth(opts, deps = {}) {
	const exec = deps.exec ?? defaultExec;
	const home = deps.home ?? homedir();
	const exists = deps.exists ?? existsSync;
	const auth = { agent: 'unknown', keyCount: null, matchingKeyLoaded: null };
	let identityFiles = [];
	let identityAgent = null;

	try {
		const gArgs = ['-G'];
		if (opts.sshConfig) gArgs.push('-F', opts.sshConfig);
		if (opts.identity) gArgs.push('-i', opts.identity);
		if (opts.sshPort && opts.sshPort !== 22) gArgs.push('-p', String(opts.sshPort));
		for (const o of opts.sshOpts ?? []) gArgs.push('-o', o);
		gArgs.push(opts.user ? `${opts.user}@${opts.host}` : opts.host);
		const g = await exec('ssh', gArgs);
		if (g.code === 0) {
			for (const line of g.stdout.split('\n')) {
				const m = line.trim().match(/^(\S+)\s+(.+)$/);
				if (!m) continue;
				const key = m[1].toLowerCase();
				if (key === 'identityfile') identityFiles.push(m[2].trim());
				else if (key === 'identityagent') identityAgent = m[2].trim();
			}
		}
	} catch {
		identityFiles = [];
	}

	let loaded = null;
	if (identityAgent && identityAgent.toLowerCase() === 'none') {
		auth.agent = 'disabled';
		auth.keyCount = 0;
		loaded = [];
	} else {
		try {
			const env = { ...process.env };
			if (identityAgent && identityAgent !== 'SSH_AUTH_SOCK') {
				env.SSH_AUTH_SOCK = expandHome(identityAgent.replace(/^"|"$/g, ''), home);
			}
			const a = await exec('ssh-add', ['-l'], { env });
			if (a.code === 0) {
				loaded = fingerprints(a.stdout);
				auth.agent = 'keys';
				auth.keyCount = loaded.length;
			} else if (a.code === 1) {
				auth.agent = 'none';
				auth.keyCount = 0;
				loaded = [];
			} else if (a.code === 2) {
				auth.agent = 'no_agent';
				auth.keyCount = 0;
				loaded = [];
			}
		} catch {
			// leave unknown
		}
	}

	if (loaded) {
		if (loaded.length === 0) {
			auth.matchingKeyLoaded = false;
		} else {
			let anyPub = false;
			let match = false;
			for (const f of identityFiles) {
				const pub = `${expandHome(f, home)}.pub`;
				if (!exists(pub)) continue;
				try {
					const k = await exec('ssh-keygen', ['-lf', pub]);
					if (k.code !== 0) continue;
					anyPub = true;
					if (fingerprints(k.stdout).some((fp) => loaded.includes(fp))) match = true;
				} catch {
					// unknown for this file
				}
			}
			auth.matchingKeyLoaded = match ? true : anyPub ? false : null;
		}
	}

	return { auth, identityFiles };
}

/**
 * The human line for a stop kind. May name the IdentityFile path: this goes
 * to the terminal only, never into --json or the journal.
 *
 * @param {string} kind
 * @param {string} host
 * @param {{auth?: object, identityFiles?: string[]}|null} [diag]
 * @returns {string}
 */
export function stopMessage(kind, host, diag = null) {
	switch (kind) {
		case 'auth_refused': {
			const files = diag?.identityFiles?.length ? diag.identityFiles.join(', ') : 'its key';
			const a = diag?.auth;
			let why;
			if (!a || a.agent === 'unknown') why = 'the key was refused';
			else if (a.agent === 'no_agent') why = 'no ssh-agent is running';
			else if (a.agent === 'disabled') why = `IdentityAgent is none, so only ${files} on disk can be offered`;
			else if (a.agent === 'none') why = 'ssh-agent has no keys loaded';
			else if (a.matchingKeyLoaded === false) why = `no key matching ${files} is loaded in ssh-agent`;
			else if (a.matchingKeyLoaded === true) why = `a key matching ${files} is loaded, but the host refused it (check its authorized_keys)`;
			else why = `could not tell whether ${files} is loaded in ssh-agent`;
			const fix = a?.matchingKeyLoaded === true ? 'fix the host side, then retry' : 'load it, then retry';
			return `${host} answered but refused the login: ${why}; ${fix}`;
		}
		case 'hostkey_missing':
			return `${host} has no known_hosts entry (host key verification failed); add its host key, then retry`;
		case 'hostkey_changed':
			return `${host}'s host key has CHANGED since it was recorded; check the machine before trusting it`;
		case 'sandbox_blocked':
			return `ssh could not read ~/.ssh although its permissions allow it: a sandbox is likely blocking it; run outside the sandbox or pass -F <config>`;
		case 'ssh_permissions':
			return `ssh could not read ~/.ssh: fix the owner or permissions of ~/.ssh and its files`;
		default:
			return `${host}: ${kind}`;
	}
}

/**
 * The JSON/journal record of a failed probe (item 4): kind, ssh's exit code
 * and the first stderr line, stripped of key material and home paths.
 *
 * @param {{kind: string, code: number, stderr?: string}} probe
 * @returns {{kind: string, sshExit: number, stderr: string}}
 */
export function probeRecord(probe) {
	return { kind: probe.kind, sshExit: probe.code, stderr: firstStderrLine(probe.stderr) };
}

/**
 * Fill journal.kind / journal.probe / journal.auth for a failure of a stop
 * kind, and return the human line (which may name the IdentityFile path; it
 * goes to the terminal only). Used by both bins. Never throws.
 *
 * @param {object} journal
 * @param {string} kind
 * @param {object|undefined} probe raw probe result, if any
 * @param {object} opts the run's options (host, -F, -i, ...)
 * @param {{diagnose?: typeof diagnoseAuth}} [deps]
 * @returns {Promise<string>}
 */
export async function recordStop(journal, kind, probe, opts, deps = {}) {
	journal.kind = kind;
	if (probe) journal.probe = probeRecord(probe);
	let diag = null;
	if (kind === 'auth_refused') {
		try {
			diag = await (deps.diagnose ?? diagnoseAuth)(opts);
			journal.auth = diag.auth;
		} catch {
			journal.auth = { agent: 'unknown', keyCount: null, matchingKeyLoaded: null };
		}
	}
	return stopMessage(kind, opts.host, diag);
}
