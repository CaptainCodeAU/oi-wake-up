import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * v1.6.0 subprocess tests: the real bins, with fake `ssh`, `ssh-add` and
 * `ssh-keygen` first on PATH. No network and no real agent, so these run in
 * the 3090's sealed run boxes too.
 *
 * The fake ssh reads a JSON list of {code, stderr} from FAKE_SSH_STATE, takes
 * one per call (the last repeats), and answers `ssh -G` from FAKE_SSH_G.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFY_BIN = resolve(__dirname, '..', 'bin', 'verify.js');
const SLEEP_BIN = resolve(__dirname, '..', 'bin', 'sleep.js');

const FAKE_SSH = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '-G') { process.stdout.write(process.env.FAKE_SSH_G || ''); process.exit(0); }
const f = process.env.FAKE_SSH_STATE;
const list = JSON.parse(fs.readFileSync(f, 'utf8'));
const next = list.length > 1 ? list.shift() : list[0];
fs.writeFileSync(f, JSON.stringify(list));
fs.appendFileSync(f + '.calls', args.join(' ') + '\\n');
if (next.sleepMs) { setTimeout(() => {}, next.sleepMs); return; }
process.stderr.write(next.stderr || '');
process.exit(next.code);
`;
const FAKE_SSH_ADD = `#!/usr/bin/env node
process.stdout.write(process.env.FAKE_SSH_ADD_OUT || '');
process.exit(Number(process.env.FAKE_SSH_ADD_CODE ?? 2));
`;
const FAKE_KEYGEN = `#!/usr/bin/env node
process.stdout.write(process.env.FAKE_KEYGEN_OUT || '');
process.exit(0);
`;

const FINGERPRINT = 'SHA256:AAAAmatchingFingerprint0000000000000000000';
const AGENT_OUT = `256 ${FINGERPRINT} someone@example.com (ED25519)\n`;
const REFUSED = 'someone@mlbox: Permission denied (publickey).\r\n';

let dir;
let home;
before(() => {
	dir = mkdtempSync(join(tmpdir(), 'oi-kinds-'));
	home = join(dir, 'home');
	for (const [name, body] of [['ssh', FAKE_SSH], ['ssh-add', FAKE_SSH_ADD], ['ssh-keygen', FAKE_KEYGEN]]) {
		const p = join(dir, name);
		writeFileSync(p, body);
		chmodSync(p, 0o755);
	}
	// A .pub beside the IdentityFile, so the match check has something to compare.
	writeFileSync(join(dir, 'id_test.pub'), 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeFakeFakeFakeFake test\n');
});
after(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
function run(bin, args, { probes, env = {} }) {
	const state = join(dir, `state-${++seq}.json`);
	writeFileSync(state, JSON.stringify(probes));
	return new Promise((res) => {
		const child = spawn(process.execPath, [bin, ...args], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				PATH: `${dir}:${process.env.PATH}`,
				HOME: home,
				FAKE_SSH_STATE: state,
				FAKE_SSH_G: `identityfile ${join(dir, 'id_test')}\n`,
				...env,
			},
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => { stdout += d; });
		child.stderr.on('data', (d) => { stderr += d; });
		child.on('exit', (code) => {
			let json = null;
			try { json = JSON.parse(stdout.trim().split('\n').at(-1)); } catch { /* null */ }
			let calls = [];
			try { calls = readFileSync(state + '.calls', 'utf8').trim().split('\n'); } catch { /* none */ }
			res({ code, json, stdout, stderr, calls });
		});
	});
}

describe('oi-wake-verify --status with kinds (subprocess)', () => {
	it('refused login: exit 0, state unreachable, kind auth_refused, probe and auth in JSON', async () => {
		const { code, json } = await run(VERIFY_BIN, ['mlbox', '--status', '--json'], {
			probes: [{ code: 255, stderr: REFUSED }],
			env: { FAKE_SSH_ADD_CODE: '1' },
		});
		assert.equal(code, 0);
		assert.equal(json.state, 'unreachable');
		assert.equal(json.kind, 'auth_refused');
		assert.deepEqual(json.probe, { kind: 'auth_refused', sshExit: 255, stderr: 'someone@mlbox: Permission denied (publickey).' });
		assert.deepEqual(json.auth, { agent: 'none', keyCount: 0, matchingKeyLoaded: false });
	});
	it('reachable: kind reachable, no probe block', async () => {
		const { code, json } = await run(VERIFY_BIN, ['mlbox', '--status', '--json'], { probes: [{ code: 0 }] });
		assert.equal(code, 0);
		assert.equal(json.state, 'reachable');
		assert.equal(json.kind, 'reachable');
		assert.equal(json.probe, undefined);
	});
	it('human line names the kind', async () => {
		const { code, stdout } = await run(VERIFY_BIN, ['mlbox', '--status'], {
			probes: [{ code: 255, stderr: 'Host key verification failed.\r\n' }],
		});
		assert.equal(code, 0);
		assert.match(stdout, /mlbox: unreachable \(hostkey_missing\)/);
	});
});

describe('oi-wake-verify stop kinds (subprocess)', () => {
	it('refused login on the first probe exits 8, never sends a wake', async () => {
		const { code, json, stderr, calls } = await run(
			VERIFY_BIN,
			['mlbox', '--mac', 'AA:BB:CC:DD:EE:FF', '--broadcast', '127.0.0.1', '--json'],
			{ probes: [{ code: 255, stderr: REFUSED }], env: { FAKE_SSH_ADD_CODE: '0', FAKE_SSH_ADD_OUT: AGENT_OUT, FAKE_KEYGEN_OUT: `256 ${FINGERPRINT} c (ED25519)\n` } },
		);
		assert.equal(code, 8);
		assert.equal(json.exit, 8);
		assert.equal(json.kind, 'auth_refused');
		assert.ok(!json.steps.some((s) => s.kind === 'wake'));
		assert.deepEqual(json.auth, { agent: 'keys', keyCount: 1, matchingKeyLoaded: true });
		assert.equal(calls.length, 1, 'one probe only');
		assert.match(stderr, /answered but refused the login/);
	});
	it('host-key changed exits 9 with kind hostkey_changed', async () => {
		const { code, json } = await run(VERIFY_BIN, ['mlbox', '--no-wake', '--json'], {
			probes: [{ code: 255, stderr: '@@@@@@@@\r\n@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\r\nHost key verification failed.\r\n' }],
		});
		assert.equal(code, 9);
		assert.equal(json.kind, 'hostkey_changed');
		assert.match(json.probe.stderr, /REMOTE HOST IDENTIFICATION HAS CHANGED/);
	});
	it('refused in the wake wait loop: exit 8 at once, no --retry-wake re-send', async () => {
		const { code, json, calls } = await run(
			VERIFY_BIN,
			['mlbox', '--mac', 'AA:BB:CC:DD:EE:FF', '--broadcast', '127.0.0.1', '--poll', '1', '--retry-wake', '2', '--json'],
			{
				probes: [
					{ code: 255, stderr: 'ssh: connect to host 192.0.2.1 port 22: Operation timed out\r\n' },
					{ code: 255, stderr: REFUSED },
				],
				env: { FAKE_SSH_ADD_CODE: '2' },
			},
		);
		assert.equal(code, 8);
		assert.equal(json.kind, 'auth_refused');
		assert.equal(json.probe.kind, 'auth_refused');
		assert.deepEqual(json.auth, { agent: 'no_agent', keyCount: 0, matchingKeyLoaded: false });
		assert.equal(json.steps.filter((s) => s.kind === 'wake').length, 1);
		assert.equal(calls.length, 2);
	});
	it('a timed-out probe records kind unreachable and its stderr line', async () => {
		const { code, json } = await run(VERIFY_BIN, ['mlbox', '--no-wake', '--json'], {
			probes: [{ code: 255, stderr: 'ssh: connect to host 192.0.2.1 port 22: Operation timed out\r\n' }],
		});
		assert.equal(code, 3);
		assert.equal(json.kind, 'unreachable');
		assert.deepEqual(json.probe, { kind: 'unreachable', sshExit: 255, stderr: 'ssh: connect to host <addr> port 22: Operation timed out' });
	});
});

describe('oi-wake-down stop kinds (subprocess)', () => {
	it('refused login exits 8 and never says "already asleep"', async () => {
		const { code, json, stdout, stderr } = await run(SLEEP_BIN, ['mlbox', '--json'], {
			probes: [{ code: 255, stderr: REFUSED }],
			env: { FAKE_SSH_ADD_CODE: '1' },
		});
		assert.equal(code, 8);
		assert.equal(json.kind, 'auth_refused');
		assert.ok(!/already asleep/.test(stdout + stderr + JSON.stringify(json)));
		assert.deepEqual(json.auth, { agent: 'none', keyCount: 0, matchingKeyLoaded: false });
	});
	it('missing host key exits 9', async () => {
		const { code, json } = await run(SLEEP_BIN, ['mlbox', '--json'], {
			probes: [{ code: 255, stderr: 'Host key verification failed.\r\n' }],
		});
		assert.equal(code, 9);
		assert.equal(json.kind, 'hostkey_missing');
	});
	it('a timed-out probe is still "already asleep", exit 0, kind unreachable', async () => {
		const { code, json } = await run(SLEEP_BIN, ['mlbox', '--json'], {
			probes: [{ code: 255, stderr: 'ssh: connect to host 192.0.2.1 port 22: Operation timed out\r\n' }],
		});
		assert.equal(code, 0);
		assert.equal(json.kind, 'unreachable');
	});
});

describe('no key material in JSON or the journal (subprocess)', () => {
	it('no fingerprint, key comment or IdentityFile path reaches stdout JSON or the journal', async () => {
		const journal = join(dir, 'journal.jsonl');
		const env = {
			FAKE_SSH_ADD_CODE: '0',
			FAKE_SSH_ADD_OUT: AGENT_OUT,
			FAKE_KEYGEN_OUT: `256 ${FINGERPRINT} c (ED25519)\n`,
		};
		const probes = [{ code: 255, stderr: `Load key "${join(dir, 'id_test')}": bad\r\n${REFUSED}` }];
		const v = await run(VERIFY_BIN, ['mlbox', '--no-wake', '--json', '--journal', journal], { probes, env });
		const d = await run(SLEEP_BIN, ['mlbox', '--json', '--journal', journal], { probes, env });
		const st = await run(VERIFY_BIN, ['mlbox', '--status', '--json', '--journal', journal], { probes, env });
		assert.equal(v.code, 8);
		assert.equal(d.code, 8);
		assert.equal(st.code, 0);
		const text = readFileSync(journal, 'utf8') + v.stdout + d.stdout + st.stdout;
		for (const bad of ['SHA256:AAAA', 'someone@example.com', 'id_test', dir]) {
			assert.ok(!text.includes(bad), `found ${bad}`);
		}
		// The path does reach the human terminal line (stderr), by design.
		assert.match(v.stderr, /id_test/);
	});
});

describe('~/.ssh read failures (subprocess, item 6)', () => {
	it('readable known_hosts: kind ssh_permissions, exit 1, home shown as ~', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(join(home, '.ssh'), { recursive: true });
		writeFileSync(join(home, '.ssh', 'known_hosts'), '');
		const { code, json } = await run(VERIFY_BIN, ['mlbox', '--no-wake', '--json'], {
			probes: [{ code: 255, stderr: `Can't open user config file ${home}/.ssh/config: Operation not permitted\r\n` }],
		});
		assert.equal(code, 1);
		assert.equal(json.kind, 'ssh_permissions');
		assert.equal(json.probe.stderr, "Can't open user config file ~/.ssh/config: Operation not permitted");
	});
	it('oi-wake-down: ssh_permissions exits 1, never "already asleep"', async () => {
		const { code, json } = await run(SLEEP_BIN, ['mlbox', '--json'], {
			probes: [{ code: 255, stderr: `Bad owner or permissions on ${home}/.ssh/config\r\n` }],
		});
		assert.equal(code, 1);
		assert.equal(json.kind, 'ssh_permissions');
	});
});
