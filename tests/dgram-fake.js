/**
 * Recording fake for the dgram socket factory injected into `wake()`.
 *
 * Usage:
 *   const fake = createDgramFake();
 *   await wake('01:02:03:04:05:06', {}, { createSocket: fake.createSocket });
 *   assert.equal(fake.sends.length, 1);
 *   assert.equal(fake.sends[0].port, 9);
 *
 * Queued / control fields on the factory:
 *   - `failSend(err?)`  — next send callback receives this error
 *   - `failBind(err?)`  — next bind triggers the socket's 'error' event instead of succeeding
 *   - `reset()`         — clears sends and error overrides
 *
 * Recorded per send:
 *   { buf: Buffer, offset, length, port, address }
 */
export function createDgramFake() {
	const sends = [];
	let _sendError = null;
	let _bindError = null;

	function createSocket(/* type */) {
		const errorHandlers = [];

		const socket = {
			once(event, handler) {
				if (event === 'error') errorHandlers.push(handler);
			},
			bind(callback) {
				if (_bindError) {
					const err = _bindError;
					_bindError = null;
					process.nextTick(() => {
						for (const h of errorHandlers) h(err);
					});
					return;
				}
				callback();
			},
			setBroadcast() {},
			send(buf, offset, length, port, address, callback) {
				sends.push({ buf: Buffer.from(buf.subarray(offset, offset + length)), port, address });
				const err = _sendError;
				_sendError = null;
				callback(err);
			},
			close() {},
		};

		return socket;
	}

	return {
		createSocket,
		sends,
		failSend(err = new Error('send failed')) {
			_sendError = err;
		},
		failBind(err = new Error('bind failed')) {
			_bindError = err;
		},
		reset() {
			sends.length = 0;
			_sendError = null;
			_bindError = null;
		},
	};
}
