import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	parseSleepArgs,
	decideSleepAction,
	executeSleepPlan,
	createLogger,
	buildSshArgs,
	SleepError,
	EXIT,
} from '../src/sleep.js';
import { createSpawnFake } from './spawn-fake.js';

function makeOpts(overrides = {}) {
	return { ...parseSleepArgs(['myhost']), ...overrides };
}

function silentLogger() {
	return createLogger('quiet', false, { stdout: () => {}, stderr: () => {} });
}

function makeJournal(opts, state = 'reachable') {
	return { host: opts.host, state, steps: [], exit: EXIT.OK, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// parseSleepArgs
// ---------------------------------------------------------------------------

describe('parseSleepArgs', () => {
	it('parses a minimal invocation', () => {
		const o = parseSleepArgs(['myhost']);
		assert.equal(o.host, 'myhost');
		assert.equal(o.sshPort, 22);
		assert.equal(o.user, null);
		assert.equal(o.identity, null);
		assert.deepEqual(o.sshOpts, []);
		assert.ok(o.command.includes('rundll32'));
		assert.equal(o.confirm, true);
		assert.equal(o.dryRun, false);
		assert.equal(o.probeTimeout, 2);
		assert.equal(o.timeout, 60);
		assert.equal(o.poll, 3);
		assert.equal(o.level, 'default');
		assert.equal(o.json, false);
		assert.equal(o.journal, null);
	});

	it('--help short-circuits without requiring host', () => {
		const o = parseSleepArgs(['--help']);
		assert.equal(o.help, true);
	});

	it('--version short-circuits', () => {
		const o = parseSleepArgs(['--version']);
		assert.equal(o.version, true);
	});

	it('throws on missing host', () => {
		assert.throws(() => parseSleepArgs([]), /Missing required argument: <host>/);
	});

	it('throws on extra positional', () => {
		assert.throws(() => parseSleepArgs(['a', 'b']), /Unexpected extra arguments: b/);
	});

	it('throws on unknown flag', () => {
		assert.throws(() => parseSleepArgs(['host', '--bogus']), /Unknown flag: --bogus/);
	});

	it('--no-confirm sets confirm=false', () => {
		const o = parseSleepArgs(['myhost', '--no-confirm']);
		assert.equal(o.confirm, false);
	});

	it('--command overrides the default', () => {
		const o = parseSleepArgs(['myhost', '--command', 'systemctl suspend']);
		assert.equal(o.command, 'systemctl suspend');
	});

	it('--ssh-port parses correctly', () => {
		const o = parseSleepArgs(['myhost', '--ssh-port', '2522']);
		assert.equal(o.sshPort, 2522);
	});

	it('--ssh-opt is repeatable', () => {
		const o = parseSleepArgs([
			'myhost',
			'--ssh-opt', 'BatchMode=yes',
			'--ssh-opt', 'ServerAliveInterval=30',
		]);
		assert.deepEqual(o.sshOpts, ['BatchMode=yes', 'ServerAliveInterval=30']);
	});

	it('--user and --identity set correctly', () => {
		const o = parseSleepArgs(['h', '--user', 'admin', '--identity', '/home/me/.ssh/key']);
		assert.equal(o.user, 'admin');
		assert.equal(o.identity, '/home/me/.ssh/key');
	});

	it('-F / --ssh-config set sshConfig (default null); forwarded via buildSshArgs', () => {
		assert.equal(parseSleepArgs(['h']).sshConfig, null);
		assert.equal(parseSleepArgs(['h', '-F', '/p/cfg']).sshConfig, '/p/cfg');
		assert.equal(parseSleepArgs(['h', '--ssh-config', '/q/cfg']).sshConfig, '/q/cfg');
		const args = buildSshArgs(parseSleepArgs(['h', '-F', '/etc/oi/ssh_config']), { remoteCommand: 'true' });
		const fIdx = args.indexOf('-F');
		assert.ok(fIdx !== -1 && args[fIdx + 1] === '/etc/oi/ssh_config', '-F path forwarded to ssh');
		assert.ok(fIdx < args.indexOf('true'), '-F before the remote command');
	});

	it('--dry-run sets dryRun', () => {
		assert.equal(parseSleepArgs(['h', '--dry-run']).dryRun, true);
		assert.equal(parseSleepArgs(['h', '-n']).dryRun, true);
	});

	it('verbosity flags work', () => {
		assert.equal(parseSleepArgs(['h', '-q']).level, 'quiet');
		assert.equal(parseSleepArgs(['h', '-v']).level, 'verbose');
		assert.equal(parseSleepArgs(['h', '-d']).level, 'debug');
		assert.equal(parseSleepArgs(['h', '--json']).json, true);
	});

	it('--journal stores path', () => {
		const o = parseSleepArgs(['h', '--journal', '/tmp/sleep.jsonl']);
		assert.equal(o.journal, '/tmp/sleep.jsonl');
	});

	it('rejects NaN / out-of-range numerics', () => {
		assert.throws(() => parseSleepArgs(['h', '--ssh-port', 'bad']), /invalid number/);
		assert.throws(() => parseSleepArgs(['h', '--ssh-port', '-1']), /port out of range/);
		assert.throws(() => parseSleepArgs(['h', '--ssh-port', '70000']), /port out of range/);
		assert.throws(() => parseSleepArgs(['h', '--timeout', '0']), /must be positive/);
		assert.throws(() => parseSleepArgs(['h', '--probe-timeout', '0']), /must be positive/);
		assert.throws(() => parseSleepArgs(['h', '--poll', '-1']), /must be positive/);
	});

	it('throws when a flag is missing its value', () => {
		assert.throws(() => parseSleepArgs(['host', '--command']), /--command requires a value/);
		assert.throws(() => parseSleepArgs(['host', '--user']), /--user requires a value/);
	});
});

// ---------------------------------------------------------------------------
// decideSleepAction — all table cells
// ---------------------------------------------------------------------------

describe('decideSleepAction — reachable', () => {
	it('default → [sleep-cmd, confirm-asleep]', () => {
		const plan = decideSleepAction('reachable', makeOpts());
		assert.deepEqual(plan, [{ kind: 'sleep-cmd' }, { kind: 'confirm-asleep' }]);
	});

	it('--no-confirm → [sleep-cmd] only', () => {
		const plan = decideSleepAction('reachable', makeOpts({ confirm: false }));
		assert.deepEqual(plan, [{ kind: 'sleep-cmd' }]);
	});
});

describe('decideSleepAction — unreachable', () => {
	it('default → noop "already asleep"', () => {
		const plan = decideSleepAction('unreachable', makeOpts());
		assert.equal(plan.length, 1);
		assert.equal(plan[0].kind, 'noop');
		assert.match(plan[0].reason, /already asleep/);
	});

	it('--no-confirm still → noop when already asleep', () => {
		const plan = decideSleepAction('unreachable', makeOpts({ confirm: false }));
		assert.equal(plan[0].kind, 'noop');
	});
});

describe('decideSleepAction — dry-run', () => {
	it('returns noop regardless of state', () => {
		assert.equal(decideSleepAction('reachable', makeOpts({ dryRun: true }))[0].kind, 'noop');
		assert.equal(decideSleepAction('unreachable', makeOpts({ dryRun: true }))[0].kind, 'noop');
	});
});

// ---------------------------------------------------------------------------
// executeSleepPlan
// ---------------------------------------------------------------------------

describe('executeSleepPlan — noop path', () => {
	it('records noop in journal and returns early', async () => {
		const opts = makeOpts();
		const plan = decideSleepAction('unreachable', opts);
		const journal = makeJournal(opts, 'unreachable');
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 2, ctrl });

		assert.equal(journal.steps.length, 1);
		assert.equal(journal.steps[0].kind, 'noop');
		assert.match(journal.steps[0].reason, /already asleep/);
	});
});

describe('executeSleepPlan — sleep-cmd + confirm-asleep', () => {
	it('sends command (exit 0) and confirms asleep', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 });                          // sleep command → success
		fake.queue({ code: 255, stderr: 'refused' });     // confirm probe → unreachable

		const opts = makeOpts({ probeTimeout: 1, timeout: 30, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});

		const sleepStep = journal.steps.find((s) => s.kind === 'sleep-cmd');
		const confirmStep = journal.steps.find((s) => s.kind === 'confirm-asleep');
		assert.equal(sleepStep?.delivered, true);
		assert.equal(sleepStep?.code, 0);
		assert.equal(confirmStep?.ok, true);
		assert.equal(fake.calls.length, 2);
	});

	it('treats connection-drop (exit 255 + "closed" stderr) as delivered', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 255, stderr: 'Connection to myhost closed.' }); // sleep cmd: conn drop
		fake.queue({ code: 255, stderr: 'connection refused' });                  // confirm: unreachable

		const opts = makeOpts({ probeTimeout: 1, timeout: 30, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});

		assert.equal(journal.steps.find((s) => s.kind === 'sleep-cmd')?.delivered, true);
		assert.equal(journal.steps.find((s) => s.kind === 'confirm-asleep')?.ok, true);
	});

	it('treats connection-drop (exit 255 + "broken pipe") as delivered', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 255, stderr: 'Write failed: Broken pipe' });
		fake.queue({ code: 255 });

		const opts = makeOpts({ probeTimeout: 1, timeout: 30, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});

		assert.equal(journal.steps.find((s) => s.kind === 'sleep-cmd')?.delivered, true);
	});

	it('treats exit 255 with empty output as delivered (host went dark immediately)', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 255, stdout: '', stderr: '' });
		fake.queue({ code: 255 });

		const opts = makeOpts({ probeTimeout: 1, timeout: 30, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});

		assert.equal(journal.steps.find((s) => s.kind === 'sleep-cmd')?.delivered, true);
	});

	it('throws SLEEP_FAILED when sleep command returns a meaningful error', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 1, stderr: 'command not found: rundll32.exe' });

		const opts = makeOpts();
		const plan = [{ kind: 'sleep-cmd' }];
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await assert.rejects(
			executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 2, ctrl }, {
				spawn: fake.spawn,
			}),
			(err) => {
				assert.ok(err instanceof SleepError, 'expected SleepError');
				assert.equal(err.exitCode, EXIT.SLEEP_FAILED);
				assert.match(err.message, /sleep command failed/);
				return true;
			},
		);
		assert.equal(journal.steps.find((s) => s.kind === 'sleep-cmd')?.delivered, false);
	});

	it('throws SLEEP_NOT_CONFIRMED when confirm-asleep times out', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 }); // sleep command: delivered
		for (let i = 0; i < 10; i++) fake.queue({ code: 0 }); // confirm probes: always reachable

		const opts = makeOpts({ probeTimeout: 1, timeout: 1, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await assert.rejects(
			executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
				spawn: fake.spawn,
				sleep: () => Promise.resolve(),
			}),
			(err) => {
				assert.ok(err instanceof SleepError, 'expected SleepError');
				assert.equal(err.exitCode, EXIT.SLEEP_NOT_CONFIRMED);
				return true;
			},
		);
		assert.equal(journal.steps.find((s) => s.kind === 'confirm-asleep')?.ok, false);
	});

	it('confirm-asleep succeeds after N reachable probes', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 });   // sleep command
		fake.queue({ code: 0 });   // confirm: still reachable
		fake.queue({ code: 0 });   // confirm: still reachable
		fake.queue({ code: 255 }); // confirm: unreachable — asleep

		const opts = makeOpts({ probeTimeout: 1, timeout: 60, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});

		const confirmStep = journal.steps.find((s) => s.kind === 'confirm-asleep');
		assert.equal(confirmStep?.ok, true);
		assert.equal(confirmStep?.attempts, 3);
	});
});

describe('executeSleepPlan — --no-confirm', () => {
	it('sends command and exits without polling', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 });

		const opts = makeOpts({ confirm: false });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 2, ctrl }, {
			spawn: fake.spawn,
		});

		assert.equal(fake.calls.length, 1); // sleep cmd only, no polling
		assert.equal(journal.steps.find((s) => s.kind === 'sleep-cmd')?.delivered, true);
		assert.equal(journal.steps.find((s) => s.kind === 'confirm-asleep'), undefined);
	});
});

describe('executeSleepPlan — journal shape', () => {
	it('sleep-cmd step records code, delivered, durationMs', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0, durationMs: 123 });
		fake.queue({ code: 255 });

		const opts = makeOpts({ probeTimeout: 1, timeout: 30, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});

		const s = journal.steps.find((s) => s.kind === 'sleep-cmd');
		assert.equal(s?.code, 0);
		assert.equal(s?.delivered, true);
		assert.equal(typeof s?.durationMs, 'number');
	});

	it('confirm-asleep step records ok, attempts, totalMs', async () => {
		const fake = createSpawnFake();
		fake.queue({ code: 0 });
		fake.queue({ code: 255 });

		const opts = makeOpts({ probeTimeout: 1, timeout: 30, poll: 1 });
		const plan = decideSleepAction('reachable', opts);
		const journal = makeJournal(opts);
		const ctrl = new AbortController();

		await executeSleepPlan(plan, opts, { log: silentLogger(), journal, total: 3, ctrl }, {
			spawn: fake.spawn,
			sleep: () => Promise.resolve(),
		});

		const c = journal.steps.find((s) => s.kind === 'confirm-asleep');
		assert.equal(c?.ok, true);
		assert.equal(typeof c?.attempts, 'number');
		assert.equal(typeof c?.totalMs, 'number');
	});
});
