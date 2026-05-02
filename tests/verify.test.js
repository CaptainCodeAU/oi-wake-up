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
} from '../src/verify.js';
import { createSpawnFake } from './spawn-fake.js';

// ---------------------------------------------------------------------------
// parseVerifyArgs
// ---------------------------------------------------------------------------

describe('parseVerifyArgs', () => {
	it('parses a minimal invocation', () => {
		const o = parseVerifyArgs(['rtx3090', '--mac', '04:7C:16:40:B4:B3']);
		assert.equal(o.host, 'rtx3090');
		assert.equal(o.mac, '04:7C:16:40:B4:B3');
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
		assert.throws(() => parseVerifyArgs(['rtx3090']), /Missing required option: --mac/);
		// --no-wake makes mac optional
		const o = parseVerifyArgs(['rtx3090', '--no-wake']);
		assert.equal(o.mac, null);
		assert.equal(o.noWake, true);
	});

	it('rejects invalid MAC', () => {
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', 'not-a-mac']),
			/Invalid MAC address: not-a-mac/,
		);
	});

	it('rejects unknown flag', () => {
		assert.throws(() => parseVerifyArgs(['rtx3090', '--bogus']), /Unknown flag: --bogus/);
	});

	it('rejects mutually exclusive mode flags', () => {
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--force', '--wake-only']),
			/Conflicting mode flags/,
		);
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--no-wake', '--dry-run']),
			/Conflicting mode flags/,
		);
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--force', '--no-restart']),
			/Conflicting mode flags/,
		);
	});

	it('rejects NaN / negative numerics', () => {
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--port', 'foo']),
			/invalid number/,
		);
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--port', '-1']),
			/port out of range/,
		);
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--port', '70000']),
			/port out of range/,
		);
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--timeout', '0']),
			/must be positive/,
		);
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--grace', '-1']),
			/must be non-negative/,
		);
	});

	it('throws when a flag is missing its value', () => {
		assert.throws(
			() => parseVerifyArgs(['rtx3090', '--mac']),
			/--mac requires a value/,
		);
	});

	it('accepts all SSH-related flags', () => {
		const o = parseVerifyArgs([
			'rtx3090',
			'--mac', '00:11:22:33:44:55',
			'--user', 'admin',
			'--ssh-port', '2522',
			'--identity', '/home/me/.ssh/mlbox',
			'--ssh-opt', 'StrictHostKeyChecking=accept-new',
			'--ssh-opt', 'ServerAliveInterval=30',
		]);
		assert.equal(o.user, 'admin');
		assert.equal(o.sshPort, 2522);
		assert.equal(o.identity, '/home/me/.ssh/mlbox');
		assert.deepEqual(o.sshOpts, [
			'StrictHostKeyChecking=accept-new',
			'ServerAliveInterval=30',
		]);
	});

	it('accepts remediation flags', () => {
		const o = parseVerifyArgs([
			'rtx3090',
			'--mac', '00:11:22:33:44:55',
			'--remediate', 'docker restart llmster',
			'--verify', 'docker exec llmster nvidia-smi',
			'--grace', '5',
		]);
		assert.equal(o.remediate, 'docker restart llmster');
		assert.equal(o.verifyCmd, 'docker exec llmster nvidia-smi');
		assert.equal(o.grace, 5);
	});

	it('verbosity tiers latch to the last one specified', () => {
		const a = parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '-q']);
		const b = parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '-v']);
		const c = parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '-d']);
		const j = parseVerifyArgs(['rtx3090', '--mac', '00:11:22:33:44:55', '--json']);
		assert.equal(a.level, 'quiet');
		assert.equal(b.level, 'verbose');
		assert.equal(c.level, 'debug');
		assert.equal(j.json, true);
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
		logger.json({ host: 'rtx3090', actions: ['wake', 'wait'], exit: 0 });
		const parsed = JSON.parse(out[0]);
		assert.equal(parsed.host, 'rtx3090');
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
	const base = {
		host: 'rtx3090',
		mac: null,
		broadcast: '255.255.255.255',
		port: 9,
		user: null,
		sshPort: 22,
		identity: null,
		sshOpts: [],
		remediate: null,
		verifyCmd: null,
		grace: 10,
		force: false,
		wakeOnly: false,
		noRestart: false,
		noWake: false,
		dryRun: false,
		timeout: 180,
		poll: 3,
		probeTimeout: 2,
		level: 'default',
		json: false,
		help: false,
		version: false,
	};

	it('emits BatchMode + ConnectTimeout for a probe', () => {
		const args = buildSshArgs(base, { connectTimeout: 2, remoteCommand: 'true' });
		assert.deepEqual(args, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=2', 'rtx3090', 'true']);
	});

	it('threads identity, ssh-port, user, ssh-opts', () => {
		const args = buildSshArgs(
			{
				...base,
				user: 'admin',
				sshPort: 2522,
				identity: '/p/id',
				sshOpts: ['StrictHostKeyChecking=no'],
			},
			{ connectTimeout: 2, remoteCommand: 'true' },
		);
		assert.deepEqual(args, [
			'-o', 'BatchMode=yes',
			'-o', 'ConnectTimeout=2',
			'-i', '/p/id',
			'-p', '2522',
			'-o', 'StrictHostKeyChecking=no',
			'admin@rtx3090',
			'true',
		]);
	});
});

// ---------------------------------------------------------------------------
// Orchestrator (Layer 2 — against the spawn fake)
// ---------------------------------------------------------------------------

const minOpts = parseVerifyArgs(['rtx3090', '--mac', '04:7C:16:40:B4:B3', '--probe-timeout', '1']);

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
	const opts = parseVerifyArgs([
		'rtx3090',
		'--mac', '04:7C:16:40:B4:B3',
		'--timeout', '60',
		'--poll', '1',
		'--probe-timeout', '1',
	]);

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
			'rtx3090',
			'--mac', '04:7C:16:40:B4:B3',
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
		const r = await runRemote(minOpts, 'docker restart llmster', { spawn: fake.spawn });
		assert.equal(r.code, 0);
		assert.equal(r.stdout, 'ok');
		assert.equal(fake.calls[0].args.at(-1), 'docker restart llmster');
	});

	it('propagates non-zero exit', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 1, stderr: 'oops' });
		const r = await runRemote(minOpts, 'false', { spawn: fake.spawn });
		assert.equal(r.code, 1);
		assert.equal(r.stderr, 'oops');
	});
});
