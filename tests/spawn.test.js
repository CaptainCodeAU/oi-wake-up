import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSsh } from '../src/spawn.js';

/**
 * Exercises the REAL spawnSsh (not the recording fake) against ordinary Unix
 * commands via the `sshBin` hook. These cover the paths the orchestrator's
 * fake can't: the `timeoutMs` -> SIGKILL kill, `maxBuffer` truncation, the
 * `code ?? (sig ? 255 : -1)` resolution, and abort-signal rejection — the
 * machinery that --remediate-timeout / --verify-timeout ride on.
 */
describe('spawnSsh (real subprocess via sshBin)', () => {
	it('resolves with code 0 and captured stdout on a clean exit', async () => {
		const r = await spawnSsh(['hello world'], { sshBin: 'echo' });
		assert.equal(r.code, 0);
		assert.equal(r.stdout.trim(), 'hello world');
		assert.equal(r.killed, false);
		assert.equal(r.signal, null);
	});

	it('propagates a non-zero exit code without rejecting', async () => {
		const r = await spawnSsh(['-c', 'exit 7'], { sshBin: 'sh' });
		assert.equal(r.code, 7);
		assert.equal(r.killed, false);
	});

	it('SIGKILLs the child when timeoutMs elapses (killed/signal/code)', async () => {
		const r = await spawnSsh(['3'], { sshBin: 'sleep', timeoutMs: 200 });
		assert.equal(r.killed, true);
		assert.equal(r.signal, 'SIGKILL');
		assert.equal(r.code, 255); // code ?? (sig ? 255 : -1)
		assert.ok(r.durationMs < 1500, `killed early (was ${r.durationMs}ms, sleep was 3000)`);
	});

	it('truncates output at maxBuffer with the [output truncated] marker', async () => {
		const payload = 'A'.repeat(40);
		const r = await spawnSsh(['-c', `printf %s ${payload}`], { sshBin: 'sh', maxBuffer: 8 });
		assert.ok(r.stdout.includes('[output truncated]'));
		assert.equal(r.stdout.split('\n[output truncated]')[0], 'A'.repeat(8));
	});

	it('rejects when the abort signal fires', async () => {
		const ctrl = new AbortController();
		const p = spawnSsh(['5'], { sshBin: 'sleep', signal: ctrl.signal });
		ctrl.abort();
		await assert.rejects(p);
	});
});
