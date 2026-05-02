import { spawn } from 'node:child_process';

/**
 * @typedef {Object} SpawnResult
 * @property {number} code - Exit code (255 if killed by signal, -1 on spawn error)
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 * @property {string|null} signal - Signal that terminated the process, if any
 */

/**
 * @typedef {Object} SpawnOptions
 * @property {AbortSignal} [signal] - Optional abort signal to cancel the spawn
 * @property {number} [timeoutMs] - Optional hard timeout in milliseconds
 */

/**
 * Spawn `ssh` with the given argument list and capture its output.
 * Resolves with `{ code, stdout, stderr, durationMs, signal }` even when
 * the child exits non-zero — only spawn errors and timeouts reject.
 *
 * Centralised so tests can swap this for a recording fake without touching
 * the orchestrator.
 *
 * @param {string[]} args - Argument list passed verbatim to `ssh`
 * @param {SpawnOptions} [opts]
 * @returns {Promise<SpawnResult>}
 */
export function spawnSsh(args, opts = {}) {
	const { signal, timeoutMs } = opts;
	const start = Date.now();

	return new Promise((resolve, reject) => {
		const child = spawn('ssh', args, { signal });

		let stdout = '';
		let stderr = '';
		let timer = null;

		if (typeof timeoutMs === 'number' && timeoutMs > 0) {
			timer = setTimeout(() => {
				child.kill('SIGKILL');
			}, timeoutMs);
		}

		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on('data', (chunk) => {
			stderr += chunk.toString();
		});

		child.once('error', (err) => {
			if (timer) clearTimeout(timer);
			reject(err);
		});

		child.once('close', (code, sig) => {
			if (timer) clearTimeout(timer);
			resolve({
				code: code ?? (sig ? 255 : -1),
				stdout,
				stderr,
				durationMs: Date.now() - start,
				signal: sig ?? null,
			});
		});
	});
}
