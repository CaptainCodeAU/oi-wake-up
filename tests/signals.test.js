import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(__dirname, '..', 'bin', 'verify.js');

/**
 * End-to-end signal test: spawn the real oi-wake-verify against a black-hole
 * address (RFC5737 TEST-NET-1, guaranteed unroutable) so it gets stuck in the
 * wait-for-SSH loop, then SIGTERM it. Regression guard for the bug that started
 * this work: the binary only trapped SIGINT, so a parent's SIGTERM (e.g. an
 * execFile timeout) killed it without flushing the journal — leaving an empty
 * file and no trace of the stalled step. It must now exit 130 AND write the
 * journal. Subprocess-based because the handler lives in bin/verify.js.
 */
describe('oi-wake-verify signal handling (subprocess)', () => {
	it('flushes the --journal on SIGTERM (not just SIGINT) and exits 130', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'oiwake-sig-'));
		const journalPath = join(dir, 'wake.jsonl');

		const child = spawn(process.execPath, [
			BIN, '192.0.2.1',
			'--mac', 'AA:BB:CC:DD:EE:FF',
			'--broadcast', '127.0.0.1', // keep the magic packet on loopback
			'--timeout', '30', '--poll', '1', '--probe-timeout', '1',
			'--journal', journalPath,
		], { stdio: 'ignore' });

		try {
			const exit = await new Promise((res) => {
				// Past the ~1s probe + the (instant) wake, so it's in the wait loop.
				setTimeout(() => child.kill('SIGTERM'), 3000);
				child.on('exit', (code, signal) => res(code ?? signal));
			});

			assert.equal(exit, 130, 'SIGTERM yields exit 130');

			const lines = readFileSync(journalPath, 'utf8').trim().split('\n');
			const record = JSON.parse(lines.at(-1));
			assert.equal(record.exit, 130, 'journal records the interrupted exit');
			assert.equal(record.state, 'unreachable');
			assert.ok(
				record.steps.some((s) => s.kind === 'wake' && s.ok === true),
				'journal still names the steps that ran before the kill',
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
