import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	classifyProbe,
	firstStderrLine,
	checkSshPermissions,
	diagnoseAuth,
	STOP_KINDS,
	exitForKind,
} from '../src/probe.js';
import { EXIT as VERIFY_EXIT } from '../src/verify.js';
import { EXIT as SLEEP_EXIT } from '../src/sleep.js';

// Real OpenSSH stderr samples (OpenSSH 9.x, BatchMode=yes).
const S = {
	authRefused: 'user@mlbox-ubuntu: Permission denied (publickey).\r\n',
	authRefusedPw: 'Permission denied (publickey,password,keyboard-interactive).\r\n',
	tooMany: 'Received disconnect from 192.0.2.5 port 22:2: Too many authentication failures\r\nDisconnected from 192.0.2.5 port 22\r\n',
	hostkeyMissing: 'Host key verification failed.\r\n',
	hostkeyMissingStrict:
		'No ED25519 host key is known for mlbox-ubuntu and you have requested strict checking.\r\nHost key verification failed.\r\n',
	hostkeyChanged:
		'@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n'
		+ '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\r\n'
		+ '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\r\n'
		+ 'IT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\r\n'
		+ 'The fingerprint for the ED25519 key sent by the remote host is\r\n'
		+ 'SHA256:Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo.\r\n'
		+ 'Host key verification failed.\r\n',
	timedOut: 'ssh: connect to host 192.0.2.1 port 22: Operation timed out\r\n',
	timedOutLinux: 'ssh: connect to host 192.0.2.1 port 22: Connection timed out\r\n',
	noRoute: 'ssh: connect to host 192.0.2.1 port 22: No route to host\r\n',
	hostDown: 'ssh: connect to host 192.0.2.1 port 22: Host is down\r\n',
	refused: 'ssh: connect to host 192.0.2.1 port 22: Connection refused\r\n',
	netUnreach: 'ssh: connect to host 192.0.2.1 port 22: Network is unreachable\r\n',
	sandbox: "Can't open user config file /Users/someone/.ssh/config: Operation not permitted\r\n",
	badPerms: 'Bad owner or permissions on /Users/someone/.ssh/config\r\n',
	resolve: 'ssh: Could not resolve hostname nosuch: nodename nor servname provided, or not known\r\n',
};

const r = (code, stderr = '') => ({ code, stderr, stdout: '', durationMs: 1 });

describe('classifyProbe', () => {
	it('exit 0 is reachable', () => {
		assert.equal(classifyProbe(r(0)).kind, 'reachable');
	});
	it('Permission denied is auth_refused', () => {
		assert.equal(classifyProbe(r(255, S.authRefused)).kind, 'auth_refused');
		assert.equal(classifyProbe(r(255, S.authRefusedPw)).kind, 'auth_refused');
	});
	it('Too many authentication failures is auth_refused', () => {
		assert.equal(classifyProbe(r(255, S.tooMany)).kind, 'auth_refused');
	});
	it('bare Host key verification failed is hostkey_missing (BatchMode, unknown host)', () => {
		assert.equal(classifyProbe(r(255, S.hostkeyMissing)).kind, 'hostkey_missing');
		assert.equal(classifyProbe(r(255, S.hostkeyMissingStrict)).kind, 'hostkey_missing');
	});
	it('the changed-key banner is hostkey_changed', () => {
		assert.equal(classifyProbe(r(255, S.hostkeyChanged)).kind, 'hostkey_changed');
	});
	for (const k of ['timedOut', 'timedOutLinux', 'noRoute', 'hostDown', 'refused', 'netUnreach']) {
		it(`${k} is unreachable`, () => {
			assert.equal(classifyProbe(r(255, S[k])).kind, 'unreachable');
		});
	}
	it('a read failure under .ssh is a permissions kind, checked before auth', () => {
		const perm = { check: () => 'sandbox_blocked' };
		assert.equal(classifyProbe(r(255, S.sandbox), perm).kind, 'sandbox_blocked');
		const plain = { check: () => 'ssh_permissions' };
		assert.equal(classifyProbe(r(255, S.badPerms), plain).kind, 'ssh_permissions');
		assert.equal(
			classifyProbe(r(255, '/Users/x/.ssh/config: Permission denied\r\n'), plain).kind,
			'ssh_permissions',
		);
	});
	it('anything else is unknown', () => {
		assert.equal(classifyProbe(r(255, S.resolve)).kind, 'unknown');
		assert.equal(classifyProbe(r(255, '')).kind, 'unknown');
	});
	it('a non-255 non-zero exit is unknown', () => {
		assert.equal(classifyProbe(r(1, 'Permission denied (publickey).')).kind, 'unknown');
	});
});

describe('firstStderrLine', () => {
	it('skips blank and @@@ banner lines', () => {
		assert.match(firstStderrLine(S.hostkeyChanged), /REMOTE HOST IDENTIFICATION HAS CHANGED/);
	});
	it('redacts fingerprints and key blobs', () => {
		const line = firstStderrLine('bad SHA256:Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo key\n');
		assert.ok(!line.includes('Zm9vYmFy'), line);
		assert.match(line, /\[redacted\]/);
		const md5 = firstStderrLine('MD5:12:34:56:78:9a:bc:de:f0:12:34:56:78:9a:bc:de:f0 here\n');
		assert.ok(!md5.includes('9a:bc'), md5);
		const blob = firstStderrLine('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyMaterialHere0123456789 x\n');
		assert.ok(!blob.includes('AAAAC3Nza'), blob);
	});
	it('replaces the home folder with ~ and hides Load key paths', () => {
		const home = '/Users/someone';
		assert.equal(
			firstStderrLine(S.sandbox, { home }),
			"Can't open user config file ~/.ssh/config: Operation not permitted",
		);
		const lk = firstStderrLine('Load key "/Users/someone/.ssh/id_secret": invalid format\n', { home });
		assert.ok(!lk.includes('id_secret'), lk);
	});
	it('returns empty string for empty input', () => {
		assert.equal(firstStderrLine(''), '');
		assert.equal(firstStderrLine(undefined), '');
	});
});

describe('checkSshPermissions', () => {
	const kh = '/h/.ssh/known_hosts';
	it('sandbox_blocked when known_hosts is unreadable but its mode allows this user', () => {
		const kind = checkSshPermissions({
			home: '/h',
			uid: 501,
			gid: 20,
			access: () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); },
			stat: (p) => { assert.equal(p, kh); return { uid: 501, gid: 20, mode: 0o100644 }; },
		});
		assert.equal(kind, 'sandbox_blocked');
	});
	it('ssh_permissions when known_hosts is readable', () => {
		const kind = checkSshPermissions({
			home: '/h', uid: 501, gid: 20,
			access: () => {},
			stat: () => ({ uid: 501, gid: 20, mode: 0o100644 }),
		});
		assert.equal(kind, 'ssh_permissions');
	});
	it('ssh_permissions when the mode does not allow this user', () => {
		const kind = checkSshPermissions({
			home: '/h', uid: 501, gid: 20,
			access: () => { throw new Error('EACCES'); },
			stat: () => ({ uid: 0, gid: 0, mode: 0o100600 }),
		});
		assert.equal(kind, 'ssh_permissions');
	});
	it('ssh_permissions when stat itself fails', () => {
		const kind = checkSshPermissions({
			home: '/h', uid: 501, gid: 20,
			access: () => { throw new Error('EPERM'); },
			stat: () => { throw new Error('EPERM'); },
		});
		assert.equal(kind, 'ssh_permissions');
	});
});

describe('stop kinds and exit codes', () => {
	it('STOP_KINDS are the kinds that end a run at once', () => {
		assert.deepEqual(
			[...STOP_KINDS].sort(),
			['auth_refused', 'hostkey_changed', 'hostkey_missing', 'sandbox_blocked', 'ssh_permissions'],
		);
	});
	it('exitForKind maps each stop kind', () => {
		assert.equal(exitForKind('auth_refused'), 8);
		assert.equal(exitForKind('hostkey_missing'), 9);
		assert.equal(exitForKind('hostkey_changed'), 9);
		assert.equal(exitForKind('sandbox_blocked'), 1);
		assert.equal(exitForKind('ssh_permissions'), 1);
		assert.equal(exitForKind('unreachable'), null);
	});
	it('both tools agree on every shared exit name and number', () => {
		assert.equal(VERIFY_EXIT.AUTH_REFUSED, 8);
		assert.equal(VERIFY_EXIT.HOSTKEY_FAILED, 9);
		for (const [name, n] of Object.entries(VERIFY_EXIT)) {
			if (name in SLEEP_EXIT) assert.equal(SLEEP_EXIT[name], n, `${name} differs`);
		}
		const vByNum = Object.fromEntries(Object.entries(VERIFY_EXIT).map(([k, v]) => [v, k]));
		for (const [name, n] of Object.entries(SLEEP_EXIT)) {
			if (n in vByNum) assert.equal(vByNum[n], name, `number ${n} means ${vByNum[n]} in verify, ${name} in sleep`);
		}
		for (const name of ['OK', 'MISCONFIG', 'AUTH_REFUSED', 'HOSTKEY_FAILED', 'USAGE', 'INTERRUPTED']) {
			assert.ok(name in SLEEP_EXIT && name in VERIFY_EXIT, `${name} missing from one table`);
		}
	});
});

// diagnoseAuth: an injected exec stands in for ssh -G, ssh-add -l, ssh-keygen -lf.
// Never the real agent.
function fakeExec(map) {
	const calls = [];
	const exec = async (cmd, args, opts = {}) => {
		calls.push({ cmd, args, env: opts.env });
		const key = `${cmd} ${args[0]}`;
		const h = map[key];
		if (!h) return { code: 127, stdout: '', stderr: 'not found' };
		return typeof h === 'function' ? h(args, opts) : h;
	};
	return { exec, calls };
}

const AGENT_LIST =
	'256 SHA256:AAAAmatchingFingerprint0000000000000000000 someone@example.com (ED25519)\n'
	+ '3072 SHA256:BBBBotherFingerprint11111111111111111111 box-key (RSA)\n';

describe('diagnoseAuth', () => {
	const opts = { host: 'mlbox', sshOpts: [], sshConfig: null, identity: null, user: null, sshPort: 22 };
	it('reports keys, count, and a matching key, without keeping the listing', async () => {
		const { exec } = fakeExec({
			'ssh -G': { code: 0, stdout: 'hostname 192.0.2.5\nidentityfile ~/.ssh/id_mlbox\nidentityagent SSH_AUTH_SOCK\n', stderr: '' },
			'ssh-add -l': { code: 0, stdout: AGENT_LIST, stderr: '' },
			'ssh-keygen -lf': (args) => {
				assert.equal(args[1], '/h/.ssh/id_mlbox.pub');
				return { code: 0, stdout: '256 SHA256:AAAAmatchingFingerprint0000000000000000000 c (ED25519)\n', stderr: '' };
			},
		});
		const d = await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		assert.deepEqual(d.auth, { agent: 'keys', keyCount: 2, matchingKeyLoaded: true });
		assert.deepEqual(d.identityFiles, ['~/.ssh/id_mlbox']);
		assert.ok(!JSON.stringify(d.auth).includes('SHA256'));
	});
	it('no matching key loaded', async () => {
		const { exec } = fakeExec({
			'ssh -G': { code: 0, stdout: 'identityfile ~/.ssh/id_mlbox\n', stderr: '' },
			'ssh-add -l': { code: 0, stdout: AGENT_LIST, stderr: '' },
			'ssh-keygen -lf': { code: 0, stdout: '256 SHA256:ZZZZnotLoaded c (ED25519)\n', stderr: '' },
		});
		const d = await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		assert.deepEqual(d.auth, { agent: 'keys', keyCount: 2, matchingKeyLoaded: false });
	});
	it('empty agent (ssh-add exit 1)', async () => {
		const { exec } = fakeExec({
			'ssh -G': { code: 0, stdout: 'identityfile ~/.ssh/id_mlbox\n', stderr: '' },
			'ssh-add -l': { code: 1, stdout: 'The agent has no identities.\n', stderr: '' },
			'ssh-keygen -lf': { code: 0, stdout: '256 SHA256:x c (ED25519)\n', stderr: '' },
		});
		const d = await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		assert.deepEqual(d.auth, { agent: 'none', keyCount: 0, matchingKeyLoaded: false });
	});
	it('no agent (ssh-add exit 2)', async () => {
		const { exec } = fakeExec({
			'ssh -G': { code: 0, stdout: 'identityfile ~/.ssh/id_mlbox\n', stderr: '' },
			'ssh-add -l': { code: 2, stdout: '', stderr: 'Could not open a connection to your authentication agent.\n' },
		});
		const d = await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		assert.deepEqual(d.auth, { agent: 'no_agent', keyCount: 0, matchingKeyLoaded: false });
	});
	it('IdentityAgent none: agent disabled, ssh-add not run', async () => {
		const { exec, calls } = fakeExec({
			'ssh -G': { code: 0, stdout: 'identityfile ~/.ssh/id_mlbox\nidentityagent none\n', stderr: '' },
		});
		const d = await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		assert.equal(d.auth.agent, 'disabled');
		assert.equal(d.auth.matchingKeyLoaded, false);
		assert.ok(!calls.some((c) => c.cmd === 'ssh-add'));
	});
	it('a custom IdentityAgent socket is passed to ssh-add as SSH_AUTH_SOCK', async () => {
		const { exec, calls } = fakeExec({
			'ssh -G': { code: 0, stdout: 'identityfile ~/.ssh/id_mlbox\nidentityagent ~/agent.sock\n', stderr: '' },
			'ssh-add -l': { code: 1, stdout: '', stderr: '' },
		});
		await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		const add = calls.find((c) => c.cmd === 'ssh-add');
		assert.equal(add.env.SSH_AUTH_SOCK, '/h/agent.sock');
	});
	it('no .pub file: matchingKeyLoaded is null, never fails', async () => {
		const { exec } = fakeExec({
			'ssh -G': { code: 0, stdout: 'identityfile ~/.ssh/id_mlbox\n', stderr: '' },
			'ssh-add -l': { code: 0, stdout: AGENT_LIST, stderr: '' },
		});
		const d = await diagnoseAuth(opts, { exec, home: '/h', exists: () => false });
		assert.deepEqual(d.auth, { agent: 'keys', keyCount: 2, matchingKeyLoaded: null });
	});
	it('tools missing or throwing give nulls, never a throw', async () => {
		const exec = async () => { throw new Error('ENOENT'); };
		const d = await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		assert.deepEqual(d.auth, { agent: 'unknown', keyCount: null, matchingKeyLoaded: null });
		assert.deepEqual(d.identityFiles, []);
	});
	it('passes -F, -i, -p and --ssh-opt to ssh -G', async () => {
		const { exec, calls } = fakeExec({ 'ssh -G': { code: 0, stdout: '', stderr: '' } });
		await diagnoseAuth(
			{ ...opts, sshConfig: '/etc/c', identity: '/k/id', sshPort: 2222, sshOpts: ['IdentitiesOnly=yes'], user: 'u' },
			{ exec, home: '/h', exists: () => true },
		);
		const g = calls.find((c) => c.cmd === 'ssh');
		assert.deepEqual(g.args, ['-G', '-F', '/etc/c', '-i', '/k/id', '-p', '2222', '-o', 'IdentitiesOnly=yes', 'u@mlbox']);
	});
	it('the private key file is never read: only .pub paths reach ssh-keygen', async () => {
		const { exec, calls } = fakeExec({
			'ssh -G': { code: 0, stdout: 'identityfile ~/.ssh/a\nidentityfile /abs/b\n', stderr: '' },
			'ssh-add -l': { code: 0, stdout: AGENT_LIST, stderr: '' },
			'ssh-keygen -lf': { code: 0, stdout: '256 SHA256:q c (ED25519)\n', stderr: '' },
		});
		await diagnoseAuth(opts, { exec, home: '/h', exists: () => true });
		const kg = calls.filter((c) => c.cmd === 'ssh-keygen').map((c) => c.args[1]);
		assert.deepEqual(kg, ['/h/.ssh/a.pub', '/abs/b.pub']);
	});
});
