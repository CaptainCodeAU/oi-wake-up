import dgram from 'node:dgram';

/**
 * Parse a MAC address string into a 6-byte Buffer.
 * Accepts colon-delimited, hyphen-delimited, or bare formats.
 * @param {string} mac
 * @returns {Buffer} 6-byte Buffer
 */
export function parseMAC(mac) {
	if (typeof mac !== 'string') {
		throw new Error(`Invalid MAC address: ${mac}`);
	}

	const stripped = mac.replace(/[:\-]/g, '');

	if (!/^[0-9a-f]{12}$/i.test(stripped)) {
		throw new Error(`Invalid MAC address: ${mac}`);
	}

	return Buffer.from(stripped, 'hex');
}

/**
 * Check if a MAC address string is valid.
 * @param {string} mac
 * @returns {boolean}
 */
export function isValidMAC(mac) {
	try {
		parseMAC(mac);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create a Wake-on-LAN magic packet for the given MAC address.
 * @param {string} mac
 * @returns {Buffer} 102-byte magic packet
 */
export function createMagicPacket(mac) {
	const macBuffer = parseMAC(mac);
	const packet = Buffer.alloc(102);

	// Sync stream: 6 bytes of 0xFF
	packet.fill(0xff, 0, 6);

	// MAC address repeated 16 times
	for (let i = 0; i < 16; i++) {
		macBuffer.copy(packet, 6 + i * 6);
	}

	return packet;
}

/**
 * @typedef {{ mac: string, address?: string, port?: number }} WakeTarget
 */

/**
 * Send a Wake-on-LAN magic packet.
 * @param {string} mac
 * @param {{ address?: string, port?: number }} [options]
 * @param {{ createSocket?: typeof import('node:dgram').createSocket }} [deps]
 * @returns {Promise<void>}
 */
export async function wake(mac, options = {}, deps = {}) {
	const { address = '255.255.255.255', port = 9 } = options;
	const createSocket = deps.createSocket ?? dgram.createSocket.bind(dgram);

	const packet = createMagicPacket(mac);

	return new Promise((resolve, reject) => {
		const socket = createSocket('udp4');

		socket.once('error', (err) => {
			socket.close();
			reject(err);
		});

		socket.bind(() => {
			socket.setBroadcast(true);
			socket.send(packet, 0, packet.length, port, address, (err) => {
				socket.close();
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	});
}

/**
 * Send Wake-on-LAN magic packets to multiple targets over a single UDP socket.
 * More efficient than calling `wake()` N times when sending to many machines.
 *
 * @param {WakeTarget[]} targets
 * @param {{ delay?: number }} [options] - Inter-packet delay in ms (default 0)
 * @param {{ createSocket?: typeof import('node:dgram').createSocket }} [deps]
 * @returns {Promise<void>}
 */
export async function wakeMany(targets, options = {}, deps = {}) {
	if (targets.length === 0) return;
	const { delay = 0 } = options;
	const createSocket = deps.createSocket ?? dgram.createSocket.bind(dgram);

	const entries = targets.map((t) => ({
		packet: createMagicPacket(t.mac),
		address: t.address ?? '255.255.255.255',
		port: t.port ?? 9,
	}));

	return new Promise((outerResolve, outerReject) => {
		const socket = createSocket('udp4');
		socket.once('error', (err) => {
			socket.close();
			outerReject(err);
		});
		socket.bind(() => {
			socket.setBroadcast(true);
			let i = 0;
			function sendNext() {
				if (i === entries.length) {
					socket.close();
					outerResolve();
					return;
				}
				const needDelay = i > 0 && delay > 0;
				const { packet, address, port } = entries[i++];
				const doSend = () => {
					socket.send(packet, 0, packet.length, port, address, (err) => {
						if (err) {
							socket.close();
							outerReject(err);
							return;
						}
						sendNext();
					});
				};
				if (needDelay) {
					setTimeout(doSend, delay);
				} else {
					doSend();
				}
			}
			sendNext();
		});
	});
}
