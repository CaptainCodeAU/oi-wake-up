import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseVerifyArgs,
	decideAction,
	createLogger,
	buildSshArgs,
	probeSsh,
	pollUntilReachable,
	runRemote,
	executePlan,
	VerifyError,
	EXIT,
} from '../src/verify.js';
import { createSpawnFake } from './spawn-fake.js';

/**
 * Build a VerifyOptions object via the real parser so defaults always stay in sync.
 * Override individual fields with the optional argument.
 */
function makeOpts(overrides = {}) {
	return { ...parseVerifyArgs(['myhost', '--mac', 'AA:BB:CC:DD:EE:FF']), ...overrides };
}

// ---------------------------------------------------------------------------
// parseVerifyArgs
// ---------------------------------------------------------------------------

describe('parseVerifyArgs', () => {
	it('parses a minimal invocation', () => {
		const o = parseVerifyArgs(['myhost', '--mac', 'AA:BB:CC:DD:EE:FF']);
		assert.equal(o.host, 'myhost');
		assert.equal(o.mac, 'AA:BB:CC:DD:EE:FF');
		assert.equal(o.broadcast, '255.255.255.255');
		assert.equal(o.port, 9);
		assert.equal(o.sshPort, 22);
		assert.equal(o.level, 'default');
		assert.equal(o.json, false);
	});

	it('--help short-circuits without requiring host or mac', () => {
		const o = parseVerifyArgs(['--help']);
		assert.equal(o.help, true);
	});

	it('--version short-circuits', () => {
		const o = parseVerifyArgs(['--version']);
		assert.equal(o.version, true);
	});

	it('throws on missing host', () => {
		assert.throws(() => parseVerifyArgs(['--mac', '00:11:22:33:44:55']), /Missing required argument: <host>/);
	});

	it('throws on extra positional', () => {
		assert.throws(
			() => parseVerifyArgs(['a', 'b', '--mac', '00:11:22:33:44:55']),
			/Unexpected extra arguments: b/,
		);
	});

	it('--mac required unless --no-wake', () => {
		assert.throws(() => parseVerifyArgs(['myhost']), /Missing required option: --mac/);
		// --no-wake makes mac optional
		const o = parseVerifyArgs(['myhost', '--no-wake']);
		assert.equal(o.mac, null);
		assert.equal(o.noWake, true);
	});

	it('rejects invalid MAC', () => {
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', 'not-a-mac']),
			/Invalid MAC address: not-a-mac/,
		);
	});

	it('rejects unknown flag', () => {
		assert.throws(() => parseVerifyArgs(['myhost', '--bogus']), /Unknown flag: --bogus/);
	});

	it('rejects mutually exclusive mode flags', () => {
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--force', '--wake-only']),
			/Conflicting mode flags/,
		);
		assert.throws(
			() => parseVerifyArgs(['myhost', '--no-wake', '--dry-run']),
			/Conflicting mode flags/,
		);
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--force', '--no-restart']),
			/Conflicting mode flags/,
		);
	});

	it('rejects NaN / negative numerics', () => {
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--port', 'foo']),
			/invalid number/,
		);
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--port', '-1']),
			/port out of range/,
		);
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--port', '70000']),
			/port out of range/,
		);
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--timeout', '0']),
			/must be positive/,
		);
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--grace', '-1']),
			/must be non-negative/,
		);
	});

	it('throws when a flag is missing its value', () => {
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac']),
			/--mac requires a value/,
		);
	});

	it('accepts all SSH-related flags', () => {
		const o = parseVerifyArgs([
			'myhost',
			'--mac', '00:11:22:33:44:55',
			'--user', 'admin',
			'--ssh-port', '2522',
			'--identity', '/home/me/.ssh/mymachine',
			'--ssh-opt', 'StrictHostKeyChecking=accept-new',
			'--ssh-opt', 'ServerAliveInterval=30',
		]);
		assert.equal(o.user, 'admin');
		assert.equal(o.sshPort, 2522);
		assert.equal(o.identity, '/home/me/.ssh/mymachine');
		assert.deepEqual(o.sshOpts, [
			'StrictHostKeyChecking=accept-new',
			'ServerAliveInterval=30',
		]);
	});

	it('accepts remediation flags', () => {
		const o = parseVerifyArgs([
			'myhost',
			'--mac', '00:11:22:33:44:55',
			'--remediate', 'docker restart mycontainer',
			'--verify', 'docker exec mycontainer nvidia-smi',
			'--grace', '5',
		]);
		assert.equal(o.remediate, 'docker restart mycontainer');
		assert.equal(o.verifyCmd, 'docker exec mycontainer nvidia-smi');
		assert.equal(o.grace, 5);
	});

	it('verbosity tiers latch to the last one specified', () => {
		const a = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '-q']);
		const b = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '-v']);
		const c = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '-d']);
		const j = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--json']);
		assert.equal(a.level, 'quiet');
		assert.equal(b.level, 'verbose');
		assert.equal(c.level, 'debug');
		assert.equal(j.json, true);
	});

	it('--journal stores the path', () => {
		const o = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--journal', '/tmp/wake.jsonl']);
		assert.equal(o.journal, '/tmp/wake.jsonl');
	});

	it('journal defaults to null', () => {
		const o = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55']);
		assert.equal(o.journal, null);
	});

	it('--retry-wake stores a non-negative integer', () => {
		const o = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--retry-wake', '3']);
		assert.equal(o.retryWake, 3);
	});

	it('--retry-wake defaults to 0', () => {
		const o = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55']);
		assert.equal(o.retryWake, 0);
	});

	it('--max-output stores the byte limit', () => {
		const o = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--max-output', '65536']);
		assert.equal(o.maxOutput, 65536);
	});

	it('--max-output defaults to 1 MiB', () => {
		const o = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55']);
		assert.equal(o.maxOutput, 1048576);
	});

	it('--remediate-timeout / --verify-timeout parse to non-negative ints', () => {
		const o = parseVerifyArgs([
			'myhost', '--mac', '00:11:22:33:44:55',
			'--remediate-timeout', '60', '--verify-timeout', '90',
		]);
		assert.equal(o.remediateTimeout, 60);
		assert.equal(o.verifyTimeout, 90);
	});

	it('--remediate-timeout / --verify-timeout default to 0 (no cap)', () => {
		const o = parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55']);
		assert.equal(o.remediateTimeout, 0);
		assert.equal(o.verifyTimeout, 0);
	});

	it('rejects negative --remediate-timeout', () => {
		assert.throws(
			() => parseVerifyArgs(['myhost', '--mac', '00:11:22:33:44:55', '--remediate-timeout', '-1']),
			/must be non-negative/,
		);
	});
});

// ---------------------------------------------------------------------------
// decideAction — every cell of the state-machine table
// ---------------------------------------------------------------------------

describe('decideAction — reachable host', () => {
	it('default → noop "already awake"', () => {
		const plan = decideAction('reachable', {});
		assert.equal(plan.length, 1);
		assert.equal(plan[0].kind, 'noop');
		assert.match(plan[0].reason, /already awake/);
	});

	it('--force → remediate + grace + verify', () => {
		const plan = decideAction('reachable', { force: true });
		assert.deepEqual(plan, [{ kind: 'remediate' }, { kind: 'grace' }, { kind: 'verify' }]);
	});

	it('--wake-only → noop "wake skipped"', () => {
		const plan = decideAction('reachable', { wakeOnly: true });
		assert.equal(plan[0].kind, 'noop');
		assert.match(plan[0].reason, /wake skipped/);
	});

	it('--no-restart → noop "nothing to do"', () => {
		const plan = decideAction('reachable', { noRestart: true });
		assert.equal(plan[0].kind, 'noop');
		assert.match(plan[0].reason, /nothing to do/);
	});

	it('--no-wake → remediate + grace + verify', () => {
		const plan = decideAction('reachable', { noWake: true });
		assert.deepEqual(plan, [{ kind: 'remediate' }, { kind: 'grace' }, { kind: 'verify' }]);
	});
});

describe('decideAction — unreachable host', () => {
	it('default → wake → wait → grace → remediate → grace → verify', () => {
		const plan = decideAction('unreachable', {});
		assert.deepEqual(plan, [
			{ kind: 'wake' },
			{ kind: 'wait' },
			{ kind: 'grace' },
			{ kind: 'remediate' },
			{ kind: 'grace' },
			{ kind: 'verify' },
		]);
	});

	it('--force same as default when unreachable', () => {
		const plan = decideAction('unreachable', { force: true });
		assert.deepEqual(plan, [
			{ kind: 'wake' },
			{ kind: 'wait' },
			{ kind: 'grace' },
			{ kind: 'remediate' },
			{ kind: 'grace' },
			{ kind: 'verify' },
		]);
	});

	it('--wake-only → wake only', () => {
		const plan = decideAction('unreachable', { wakeOnly: true });
		assert.deepEqual(plan, [{ kind: 'wake' }]);
	});

	it('--no-restart → wake + wait', () => {
		const plan = decideAction('unreachable', { noRestart: true });
		assert.deepEqual(plan, [{ kind: 'wake' }, { kind: 'wait' }]);
	});

	it('--no-wake → abort with exit 3', () => {
		const plan = decideAction('unreachable', { noWake: true });
		assert.equal(plan[0].kind, 'abort');
		assert.equal(plan[0].exitCode, 3);
	});
});

describe('decideAction — dry-run', () => {
	it('returns a noop step regardless of state', () => {
		assert.equal(decideAction('reachable', { dryRun: true })[0].kind, 'noop');
		assert.equal(decideAction('unreachable', { dryRun: true })[0].kind, 'noop');
	});
});

// ---------------------------------------------------------------------------
// createLogger
// ---------------------------------------------------------------------------

function captureLogger(level, json) {
	const out = [];
	const err = [];
	const logger = createLogger(level, json, {
		stdout: (s) => out.push(s),
		stderr: (s) => err.push(s),
	});
	return { logger, out, err };
}

describe('createLogger — non-json modes', () => {
	it('quiet suppresses everything except errors', () => {
		const { logger, out, err } = captureLogger('quiet', false);
		logger.info('i');
		logger.step(1, 1, 's');
		logger.verbose('v');
		logger.debug('d');
		logger.error('e');
		assert.deepEqual(out, []);
		assert.deepEqual(err, ['e']);
	});

	it('default emits step+info+error, suppresses verbose+debug', () => {
		const { logger, out, err } = captureLogger('default', false);
		logger.step(1, 4, 'probing');
		logger.info('hi');
		logger.verbose('detail');
		logger.debug('dump');
		logger.error('boom');
		assert.deepEqual(out, ['[1/4] probing', 'hi']);
		assert.deepEqual(err, ['boom']);
	});

	it('verbose adds verbose, still no debug', () => {
		const { logger, out } = captureLogger('verbose', false);
		logger.verbose('v');
		logger.debug('d');
		assert.deepEqual(out, ['v']);
	});

	it('debug emits everything', () => {
		const { logger, out } = captureLogger('debug', false);
		logger.verbose('v');
		logger.debug('d');
		assert.deepEqual(out, ['v', 'd']);
	});
});

describe('createLogger — json mode', () => {
	it('progress goes to stderr, json() goes to stdout', () => {
		const { logger, out, err } = captureLogger('verbose', true);
		logger.step(1, 4, 'probing');
		logger.info('hi');
		logger.verbose('detail');
		logger.debug('hidden at verbose');
		logger.error('boom');
		logger.json({ ok: true, exit: 0 });

		assert.deepEqual(out, ['{"ok":true,"exit":0}']);
		assert.deepEqual(err, ['[1/4] probing', 'hi', 'detail', 'boom']);
	});

	it('json output is parseable', () => {
		const { logger, out } = captureLogger('default', true);
		logger.json({ host: 'myhost', actions: ['wake', 'wait'], exit: 0 });
		const parsed = JSON.parse(out[0]);
		assert.equal(parsed.host, 'myhost');
		assert.deepEqual(parsed.actions, ['wake', 'wait']);
	});

	it('quiet+json still emits json but suppresses progress', () => {
		const { logger, out, err } = captureLogger('quiet', true);
		logger.step(1, 1, 'x');
		logger.info('hi');
		logger.error('e');
		logger.json({ ok: false });
		assert.deepEqual(out, ['{"ok":false}']);
		assert.deepEqual(err, ['e']);
	});
});

// ---------------------------------------------------------------------------
// buildSshArgs
// ---------------------------------------------------------------------------

describe('buildSshArgs', () => {
	it('emits BatchMode + ConnectTimeout for a probe', () => {
		const args = buildSshArgs(makeOpts(), { connectTimeout: 2, remoteCommand: 'true' });
		assert.deepEqual(args, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=2', 'myhost', 'true']);
	});

	it('threads identity, ssh-port, user, ssh-opts', () => {
		const args = buildSshArgs(
			makeOpts({ user: 'admin', sshPort: 2522, identity: '/p/id', sshOpts: ['StrictHostKeyChecking=no'] }),
			{ connectTimeout: 2, remoteCommand: 'true' },
		);
		assert.deepEqual(args, [
			'-o', 'BatchMode=yes',
			'-o', 'ConnectTimeout=2',
			'-i', '/p/id',
			'-p', '2522',
			'-o', 'StrictHostKeyChecking=no',
			'admin@myhost',
			'true',
		]);
	});

	it('emits ServerAlive options only when requested', () => {
		const args = buildSshArgs(makeOpts(), {
			connectTimeout: 10,
			serverAliveInterval: 5,
			serverAliveCountMax: 3,
			remoteCommand: 'just restart',
		});
		assert.deepEqual(args, [
			'-o', 'BatchMode=yes',
			'-o', 'ConnectTimeout=10',
			'-o', 'ServerAliveInterval=5',
			'-o', 'ServerAliveCountMax=3',
			'myhost',
			'just restart',
		]);
	});
});

// ---------------------------------------------------------------------------
// Orchestrator (Layer 2 — against the spawn fake)
// ---------------------------------------------------------------------------

const minOpts = makeOpts({ probeTimeout: 1 });

describe('probeSsh', () => {
	it('reports reachable when ssh exits 0', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 });
		const r = await probeSsh(minOpts, { spawn: fake.spawn });
		assert.equal(r.reachable, true);
		assert.equal(fake.calls.length, 1);
		// Probe command is "true"
		assert.equal(fake.calls[0].args.at(-1), 'true');
		assert.ok(fake.calls[0].args.includes('BatchMode=yes'));
	});

	it('reports unreachable when ssh exits non-zero', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 255, stderr: 'connection refused' });
		const r = await probeSsh(minOpts, { spawn: fake.spawn });
		assert.equal(r.reachable, false);
		assert.equal(r.code, 255);
	});
});

describe('pollUntilReachable', () => {
	const opts = makeOpts({ timeout: 60, poll: 1, probeTimeout: 1 });

	it('returns ok after N failures then a success', async () => {
		const fake = createSpawnFake();
		fake.failTimes(3); // 3 × 255, then 1 × 0
		const r = await pollUntilReachable(opts, null, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});
		assert.equal(r.ok, true);
		assert.equal(r.attempts, 4);
		assert.equal(fake.calls.length, 4);
	});

	it('reports !ok when timeout elapses', async () => {
		const tightOpts = parseVerifyArgs([
			'myhost',
			'--mac', 'AA:BB:CC:DD:EE:FF',
			'--timeout', '1',
			'--poll', '1',
			'--probe-timeout', '1',
		]);
		const fake = createSpawnFake();
		// Always fail
		for (let i = 0; i < 20; i++) fake.queue({ code: 255 });
		const r = await pollUntilReachable(tightOpts, null, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});
		assert.equal(r.ok, false);
		assert.ok(r.attempts >= 1);
	});

	it('calls onProgress per attempt', async () => {
		const fake = createSpawnFake();
		fake.failTimes(2);
		const events = [];
		await pollUntilReachable(
			opts,
			(attempt, code) => events.push({ attempt, code }),
			{ spawn: fake.spawn, sleep: () => Promise.resolve() },
		);
		assert.equal(events.length, 3);
		assert.equal(events[0].attempt, 1);
		assert.equal(events[2].code, 0);
	});

	it('aborts cleanly when signal already aborted', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 255 });
		const ctrl = new AbortController();
		ctrl.abort();
		const r = await pollUntilReachable(opts, null, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
			signal: ctrl.signal,
		});
		assert.equal(r.ok, false);
		assert.equal(fake.calls.length, 0);
	});
});

describe('runRemote', () => {
	it('passes the command verbatim as the trailing arg', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0, stdout: 'ok' });
		const r = await runRemote(minOpts, 'docker restart mycontainer', { spawn: fake.spawn });
		assert.equal(r.code, 0);
		assert.equal(r.stdout, 'ok');
		assert.equal(fake.calls[0].args.at(-1), 'docker restart mycontainer');
	});

	it('propagates non-zero exit', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 1, stderr: 'oops' });
		const r = await runRemote(minOpts, 'false', { spawn: fake.spawn });
		assert.equal(r.code, 1);
		assert.equal(r.stderr, 'oops');
	});

	it('forwards connectTimeout, serverAlive, and timeoutMs when provided', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 });
		await runRemote(minOpts, 'just restart', {
			spawn: fake.spawn,
			connectTimeout: 10,
			serverAliveInterval: 5,
			serverAliveCountMax: 3,
			timeoutMs: 60000,
		});
		const { args, opts } = fake.calls[0];
		assert.ok(args.includes('ConnectTimeout=10'));
		assert.ok(args.includes('ServerAliveInterval=5'));
		assert.ok(args.includes('ServerAliveCountMax=3'));
		assert.equal(opts.timeoutMs, 60000);
	});

	it('omits hardening args when not provided (oi-wake-down compatibility)', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 });
		await runRemote(minOpts, 'just restart', { spawn: fake.spawn });
		const { args, opts } = fake.calls[0];
		assert.ok(!args.some((a) => a.startsWith('ConnectTimeout')));
		assert.ok(!args.some((a) => a.startsWith('ServerAlive')));
		assert.equal(opts.timeoutMs, undefined);
	});
});

// ---------------------------------------------------------------------------
// executePlan (integration — full unreachable path through the spawn fake)
// ---------------------------------------------------------------------------

describe('executePlan', () => {
	it('runs the full unreachable path: wake → wait → remediate → verify', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 255 }); // poll attempt 1: not up yet
		fake.queue({ code: 0 });   // poll attempt 2: SSH up
		fake.queue({ code: 0, stdout: 'restarted' }); // remediate
		fake.queue({ code: 0, stdout: 'healthy' });   // verify

		const opts = makeOpts({ remediate: 'restart', verifyCmd: 'check', grace: 0 });
		const plan = decideAction('unreachable', {});
		const journal = { host: opts.host, state: 'unreachable', steps: [], exit: 0, durationMs: 0 };
		const log = createLogger('quiet', false, { stdout: () => {}, stderr: () => {} });
		const ctrl = new AbortController();

		let wakeCalled = false;
		await executePlan(plan, opts, { log, journal, total: plan.length + 1, ctrl }, {
			spawn: fake.spawn,
			wake: async () => { wakeCalled = true; },
			sleep: () => Promise.resolve(),
		});

		assert.ok(wakeCalled, 'wake was called');
		assert.equal(journal.steps.find((s) => s.kind === 'wake')?.ok, true);
		assert.equal(journal.steps.find((s) => s.kind === 'wait')?.ok, true);
		assert.equal(journal.steps.find((s) => s.kind === 'remediate')?.code, 0);
		assert.equal(journal.steps.find((s) => s.kind === 'verify')?.code, 0);
		assert.equal(fake.calls.length, 4);
	});

	it('noop path records and returns early', async () => {
		const opts = makeOpts({ grace: 0 });
		const plan = decideAction('reachable', {});
		const journal = { host: opts.host, state: 'reachable', steps: [], exit: 0, durationMs: 0 };
		const log = createLogger('quiet', false, { stdout: () => {}, stderr: () => {} });
		const ctrl = new AbortController();

		await executePlan(plan, opts, { log, journal, total: 2, ctrl });

		assert.equal(journal.steps.length, 1);
		assert.equal(journal.steps[0].kind, 'noop');
	});

	it('--retry-wake re-sends wake and re-polls when first SSH poll times out', async () => {
		const fake = createSpawnFake();
		// First wait: one failure (deadline expires after 1 attempt at instant sleep)
		fake.queue({ code: 255 });
		// Second wait (after retry wake): succeed on first attempt
		fake.queue({ code: 0 });

		const opts = makeOpts({ retryWake: 1, timeout: 1, poll: 1, probeTimeout: 1, grace: 0 });
		const plan = decideAction('unreachable', { wakeOnly: false, noRestart: true }); // wake + wait only
		const journal = { host: opts.host, state: 'unreachable', steps: [], exit: 0, durationMs: 0 };
		const log = createLogger('quiet', false, { stdout: () => {}, stderr: () => {} });
		const ctrl = new AbortController();

		let wakeCount = 0;
		await executePlan(plan, opts, { log, journal, total: plan.length + 1, ctrl }, {
			spawn: fake.spawn,
			wake: async () => { wakeCount++; },
			sleep: () => Promise.resolve(),
		});

		assert.equal(wakeCount, 2, 'wake step + one retry = 2 total sends');
		assert.equal(journal.steps.find((s) => s.kind === 'wait')?.ok, true);
	});

	it('remediate timeout-kill → REMEDIATION_FAILED with "timed out"', async () => {
		const fake = createSpawnFake();
		fake.queue({ killed: true, code: 255, signal: 'SIGKILL' }); // remediate SIGKILLed by timeoutMs
		const opts = makeOpts({ remediate: 'just restart', verifyCmd: 'just warmup', grace: 0, remediateTimeout: 5 });
		const plan = decideAction('reachable', { force: true }); // [remediate, grace, verify]
		const journal = { host: opts.host, state: 'reachable', steps: [], exit: 0, durationMs: 0 };
		const log = createLogger('quiet', false, { stdout: () => {}, stderr: () => {} });
		const ctrl = new AbortController();
		await assert.rejects(
			executePlan(plan, opts, { log, journal, total: plan.length + 1, ctrl }, {
				spawn: fake.spawn, sleep: () => Promise.resolve(),
			}),
			(e) => e instanceof VerifyError && e.exitCode === EXIT.REMEDIATION_FAILED && /timed out after 5s/.test(e.message),
		);
		// verify must NOT have run — remediate aborted the plan
		assert.equal(fake.calls.length, 1);
	});

	it('verify timeout-kill → VERIFY_FAILED with "timed out"', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0, stdout: 'restarted' });               // remediate ok
		fake.queue({ killed: true, code: 255, signal: 'SIGKILL' }); // verify SIGKILLed by timeoutMs
		const opts = makeOpts({ remediate: 'just restart', verifyCmd: 'just warmup', grace: 0, verifyTimeout: 90 });
		const plan = decideAction('reachable', { force: true });
		const journal = { host: opts.host, state: 'reachable', steps: [], exit: 0, durationMs: 0 };
		const log = createLogger('quiet', false, { stdout: () => {}, stderr: () => {} });
		const ctrl = new AbortController();
		await assert.rejects(
			executePlan(plan, opts, { log, journal, total: plan.length + 1, ctrl }, {
				spawn: fake.spawn, sleep: () => Promise.resolve(),
			}),
			(e) => e instanceof VerifyError && e.exitCode === EXIT.VERIFY_FAILED && /timed out after 90s/.test(e.message),
		);
	});

	it('remediate/verify SSH carries ConnectTimeout + ServerAlive hardening', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0, stdout: 'restarted' }); // remediate
		fake.queue({ code: 0, stdout: 'healthy' });   // verify
		const opts = makeOpts({ remediate: 'just restart', verifyCmd: 'just warmup', grace: 0 });
		const plan = decideAction('reachable', { force: true });
		const journal = { host: opts.host, state: 'reachable', steps: [], exit: 0, durationMs: 0 };
		const log = createLogger('quiet', false, { stdout: () => {}, stderr: () => {} });
		const ctrl = new AbortController();
		await executePlan(plan, opts, { log, journal, total: plan.length + 1, ctrl }, {
			spawn: fake.spawn, sleep: () => Promise.resolve(),
		});
		assert.equal(fake.calls.length, 2);
		for (const call of fake.calls) {
			assert.ok(call.args.includes('ConnectTimeout=10'), 'ConnectTimeout present');
			assert.ok(call.args.includes('ServerAliveInterval=5'), 'ServerAliveInterval present');
			assert.ok(call.args.includes('ServerAliveCountMax=3'), 'ServerAliveCountMax present');
		}
	});
});
