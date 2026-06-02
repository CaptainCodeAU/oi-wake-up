/**
 * Recording fake for `spawnSsh`. Drop-in replacement for tests:
 *
 *   const fake = createSpawnFake();
 *   fake.queue({ code: 0, stdout: 'ok' });
 *   await pollUntilReachable(opts, null, { spawn: fake.spawn });
 *   assert.equal(fake.calls.length, 1);
 *
 * Queued response fields:
 *   - `code`      — exit code (default 0)
 *   - `stdout`    — captured stdout (default '')
 *   - `stderr`    — captured stderr (default '')
 *   - `durationMs`— reported duration (default 0)
 *   - `signal`    — signal name (default null)
 *   - `killed`    — true if killed by signal (default false)
 *   - `delay`     — artificial latency in ms; honours `opts.signal` abort
 *   - `throw`     — if truthy, the spawn call rejects with this value as the error
 *
 * Helpers:
 *   - `failTimes(n)` queues `n` failures (exit 255) followed by one success.
 */
export function createSpawnFake() {
	const queue = [];
	const calls = [];

	function spawn(args, opts = {}) {
		calls.push({ args, opts });

		if (opts.signal?.aborted) {
			return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
		}

		const next = queue.shift() ?? { code: 0, stdout: '', stderr: '' };
		const response = {
			code: next.code ?? 0,
			stdout: next.stdout ?? '',
			stderr: next.stderr ?? '',
			durationMs: next.durationMs ?? 0,
			signal: next.signal ?? null,
			killed: next.killed ?? false,
		};

		if (next.delay && next.delay > 0) {
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => resolve(response), next.delay);
				if (opts.signal) {
					opts.signal.addEventListener('abort', () => {
						clearTimeout(timer);
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					});
				}
			});
		}

		if (next.throw) return Promise.reject(next.throw);
		return Promise.resolve(response);
	}

	return {
		spawn,
		calls,
		queue(...responses) {
			queue.push(...responses);
		},
		/** Queue `n` failures (exit 255) then one success. */
		failTimes(n, success = { code: 0 }) {
			for (let i = 0; i < n; i++) {
				queue.push({ code: 255, stderr: 'connection refused' });
			}
			queue.push(success);
		},
		reset() {
			queue.length = 0;
			calls.length = 0;
		},
		get pending() {
			return queue.length;
		},
	};
}
