import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFY_BIN = resolve(__dirname, '..', 'bin', 'verify.js');
const SLEEP_BIN = resolve(__dirname, '..', 'bin', 'sleep.js');

/**
 * Spawn a real binary, collect stdout (where --json writes its object), and
 * resolve with { code, json }. These cover behaviour that lives in bin/*.js
 * (the journal object, the --status short-circuit, the not-captured marker)
 * and so is not reachable through executePlan unit tests.
 *
 * 192.0.2.1 is RFC5737 TEST-NET-1 — guaranteed unroutable, so SSH probes fail
 * fast. Magic packets are aimed at 127.0.0.1 to keep them on loopback.
 */
function runBin(bin, args) {
	return new Promise((res) => {
		const child = spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
		let stdout = '';
		child.stdout.on('data', (d) => { stdout += d; });
		child.on('exit', (code, signal) => {
			let json = null;
			try { json = JSON.parse(stdout.trim().split('\n').at(-1)); } catch { /* leave null */ }
			res({ code: code ?? signal, json });
		});
	});
}

const isoOk = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));

describe('observability — ts/finishedAt on --json (C1, subprocess)', () => {
	it('oi-wake-verify --dry-run --json carries valid ts and finishedAt', async () => {
		const { code, json } = await runBin(VERIFY_BIN, [
			'anyhost', '--mac', 'AA:BB:CC:DD:EE:FF', '--dry-run', '--json',
		]);
		assert.equal(code, 0);
		assert.ok(isoOk(json.ts), 'ts is ISO-8601');
		assert.ok(isoOk(json.finishedAt), 'finishedAt is ISO-8601');
		assert.ok(Date.parse(json.finishedAt) >= Date.parse(json.ts));
		assert.equal(json.state, 'dry-run');
	});

	it('oi-wake-down --dry-run --json carries ts (parity)', async () => {
		const { code, json } = await runBin(SLEEP_BIN, ['anyhost', '--dry-run', '--json']);
		assert.equal(code, 0);
		assert.ok(isoOk(json.ts), 'ts is ISO-8601');
		assert.ok(isoOk(json.finishedAt), 'finishedAt is ISO-8601');
	});
});

describe('observability — --status probe-only mode (C4, subprocess)', () => {
	it('exits 0 on an unreachable host (no exit 3) and works without --mac', async () => {
		const { code, json } = await runBin(VERIFY_BIN, [
			'192.0.2.1', '--status', '--json', '--probe-timeout', '1',
		]);
		assert.equal(code, 0, '--status exits 0 even when unreachable');
		assert.equal(json.state, 'unreachable');
		assert.ok(!json.steps.some((s) => s.kind === 'wake'), 'no wake performed');
	});
});

describe('observability — wake-only not-captured marker (C2, subprocess)', () => {
	it('records performedWake:true, captured:false with a wake-only reason', async () => {
		const { code, json } = await runBin(VERIFY_BIN, [
			'192.0.2.1', '--mac', 'AA:BB:CC:DD:EE:FF',
			'--wake-only', '--capture-wake-source', '--broadcast', '127.0.0.1', '--json',
		]);
		assert.equal(code, 0);
		assert.equal(json.wakeSource.performedWake, true);
		assert.equal(json.wakeSource.captured, false);
		assert.match(json.wakeSource.reason, /wake-only/);
	});
});
