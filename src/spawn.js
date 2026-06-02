import { spawn } from 'node:child_process';

/**
 * @typedef {Object} SpawnResult
 * @property {number} code - Exit code. NOTE: SSH itself returns 255 for connectivity
 *   failures AND the OS returns 255 when the process is killed by a signal, so code
 *   alone is ambiguous. Use `killed` to distinguish.
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} durationMs
 * @property {string|null} signal - Signal name that terminated the process (e.g. "SIGKILL"), or null
 * @property {boolean} killed - True when the process was terminated by a signal (not a normal exit)
 */

/**
 * @typedef {Object} SpawnOptions
 * @property {AbortSignal} [signal] - Optional abort signal to cancel the spawn
 * @property {number} [timeoutMs] - Optional hard timeout in milliseconds
 * @property {number} [maxBuffer] - Max combined stdout+stderr bytes before truncation (default 1 MiB)
 * @property {string} [sshBin] - SSH binary to invoke (default 'ssh')
 */

const DEFAULT_MAX_BUFFER = 1048576; // 1 MiB
const TRUNCATION_MARKER = '\n[output truncated]';

/**
 * Spawn `ssh` with the given argument list and capture its output.
 * Resolves with `{ code, stdout, stderr, durationMs, signal, killed }` even when
 * the child exits non-zero — only spawn errors reject.
 *
 * Centralised so tests can swap this for a recording fake without touching
 * the orchestrator.
 *
 * @param {string[]} args - Argument list passed verbatim to the SSH binary
 * @param {SpawnOptions} [opts]
 * @returns {Promise<SpawnResult>}
 */
export function spawnSsh(args, opts = {}) {
	const { signal, timeoutMs, maxBuffer = DEFAULT_MAX_BUFFER, sshBin = 'ssh' } = opts;
	const start = Date.now();

	return new Promise((resolve, reject) => {
		const child = spawn(sshBin, args, { signal });

		let stdout = '';
		let stderr = '';
		let buffered = 0;
		let truncated = false;
		let timer = null;

		if (typeof timeoutMs === 'number' && timeoutMs > 0) {
			timer = setTimeout(() => {
				child.kill('SIGKILL');
			}, timeoutMs);
		}

		child.stdout.on('data', (chunk) => {
			if (truncated) return;
			const str = chunk.toString();
			const remaining = maxBuffer - buffered;
			if (str.length <= remaining) {
				stdout += str;
				buffered += str.length;
			} else {
				stdout += str.slice(0, remaining) + TRUNCATION_MARKER;
				buffered = maxBuffer;
				truncated = true;
			}
		});

		child.stderr.on('data', (chunk) => {
			if (truncated) return;
			const str = chunk.toString();
			const remaining = maxBuffer - buffered;
			if (str.length <= remaining) {
				stderr += str;
				buffered += str.length;
			} else {
				stderr += str.slice(0, remaining) + TRUNCATION_MARKER;
				buffered = maxBuffer;
				truncated = true;
			}
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
				killed: sig !== null,
			});
		});
	});
}
