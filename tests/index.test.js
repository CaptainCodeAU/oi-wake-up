import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMAC, isValidMAC, createMagicPacket, wake, wakeMany } from '../src/index.js';
import { createDgramFake } from './dgram-fake.js';

describe('parseMAC', () => {
	it('parses colon-delimited MAC', () => {
		const buf = parseMAC('01:02:03:04:05:06');
		assert.deepStrictEqual(buf, Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]));
	});

	it('parses hyphen-delimited MAC', () => {
		const buf = parseMAC('01-02-03-04-05-06');
		assert.deepStrictEqual(buf, Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]));
	});

	it('parses bare MAC', () => {
		const buf = parseMAC('010203040506');
		assert.deepStrictEqual(buf, Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]));
	});

	it('is case-insensitive', () => {
		const upper = parseMAC('AA:BB:CC:DD:EE:FF');
		const lower = parseMAC('aa:bb:cc:dd:ee:ff');
		const mixed = parseMAC('aA:bB:cC:dD:eE:fF');
		assert.deepStrictEqual(upper, lower);
		assert.deepStrictEqual(upper, mixed);
	});

	it('throws on empty string', () => {
		assert.throws(() => parseMAC(''), { message: 'Invalid MAC address: ' });
	});

	it('throws on too-short MAC', () => {
		assert.throws(() => parseMAC('01:02:03'), { message: 'Invalid MAC address: 01:02:03' });
	});

	it('throws on too-long MAC', () => {
		assert.throws(() => parseMAC('01:02:03:04:05:06:07'), {
			message: 'Invalid MAC address: 01:02:03:04:05:06:07',
		});
	});

	it('throws on non-hex characters', () => {
		assert.throws(() => parseMAC('GG:HH:II:JJ:KK:LL'), {
			message: 'Invalid MAC address: GG:HH:II:JJ:KK:LL',
		});
	});

	it('throws on non-string input', () => {
		assert.throws(() => parseMAC(123), { message: 'Invalid MAC address: 123' });
		assert.throws(() => parseMAC(null), { message: 'Invalid MAC address: null' });
		assert.throws(() => parseMAC(undefined), { message: 'Invalid MAC address: undefined' });
	});
});

describe('isValidMAC', () => {
	it('returns true for valid MACs', () => {
		assert.strictEqual(isValidMAC('01:02:03:04:05:06'), true);
		assert.strictEqual(isValidMAC('01-02-03-04-05-06'), true);
		assert.strictEqual(isValidMAC('010203040506'), true);
		assert.strictEqual(isValidMAC('AA:BB:CC:DD:EE:FF'), true);
	});

	it('returns false for invalid MACs', () => {
		assert.strictEqual(isValidMAC(''), false);
		assert.strictEqual(isValidMAC('not-a-mac'), false);
		assert.strictEqual(isValidMAC('GG:HH:II:JJ:KK:LL'), false);
		assert.strictEqual(isValidMAC(123), false);
		assert.strictEqual(isValidMAC(null), false);
	});
});

describe('createMagicPacket', () => {
	it('returns a 102-byte Buffer', () => {
		const packet = createMagicPacket('01:02:03:04:05:06');
		assert.strictEqual(packet.length, 102);
	});

	it('starts with 6 bytes of 0xFF', () => {
		const packet = createMagicPacket('01:02:03:04:05:06');
		for (let i = 0; i < 6; i++) {
			assert.strictEqual(packet[i], 0xff, `byte ${i} should be 0xFF`);
		}
	});

	it('contains the MAC address repeated 16 times', () => {
		const packet = createMagicPacket('01:02:03:04:05:06');
		const mac = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		for (let rep = 0; rep < 16; rep++) {
			const offset = 6 + rep * 6;
			assert.deepStrictEqual(
				packet.subarray(offset, offset + 6),
				mac,
				`repetition ${rep} at offset ${offset} should match MAC`,
			);
		}
	});

	it('throws on invalid MAC', () => {
		assert.throws(() => createMagicPacket('invalid'), {
			message: 'Invalid MAC address: invalid',
		});
	});
});

// ---------------------------------------------------------------------------
// wake
// ---------------------------------------------------------------------------

describe('wake', () => {
	it('sends a 102-byte magic packet to the default address and port', async () => {
		const fake = createDgramFake();
		await wake('01:02:03:04:05:06', {}, { createSocket: fake.createSocket });
		assert.equal(fake.sends.length, 1);
		assert.equal(fake.sends[0].address, '255.255.255.255');
		assert.equal(fake.sends[0].port, 9);
		assert.equal(fake.sends[0].buf.length, 102);
	});

	it('respects custom address and port', async () => {
		const fake = createDgramFake();
		await wake('01:02:03:04:05:06', { address: '192.168.1.255', port: 7 }, { createSocket: fake.createSocket });
		assert.equal(fake.sends[0].address, '192.168.1.255');
		assert.equal(fake.sends[0].port, 7);
	});

	it('sends the correct magic packet content', async () => {
		const fake = createDgramFake();
		await wake('01:02:03:04:05:06', {}, { createSocket: fake.createSocket });
		const packet = fake.sends[0].buf;
		// Sync stream: first 6 bytes are 0xFF
		for (let i = 0; i < 6; i++) assert.equal(packet[i], 0xff, `byte ${i}`);
		// MAC repeated 16 times
		const mac = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		for (let rep = 0; rep < 16; rep++) {
			const offset = 6 + rep * 6;
			assert.deepEqual(packet.subarray(offset, offset + 6), mac, `repetition ${rep}`);
		}
	});

	it('rejects when send fails', async () => {
		const fake = createDgramFake();
		fake.failSend(new Error('network unreachable'));
		await assert.rejects(() => wake('01:02:03:04:05:06', {}, { createSocket: fake.createSocket }), {
			message: 'network unreachable',
		});
	});

	it('rejects when bind fails', async () => {
		const fake = createDgramFake();
		fake.failBind(new Error('EADDRINUSE'));
		await assert.rejects(() => wake('01:02:03:04:05:06', {}, { createSocket: fake.createSocket }), {
			message: 'EADDRINUSE',
		});
	});

	it('rejects on invalid MAC before touching the socket', async () => {
		const fake = createDgramFake();
		await assert.rejects(() => wake('not-a-mac', {}, { createSocket: fake.createSocket }), {
			message: 'Invalid MAC address: not-a-mac',
		});
		assert.equal(fake.sends.length, 0);
	});
});

// ---------------------------------------------------------------------------
// wakeMany
// ---------------------------------------------------------------------------

describe('wakeMany', () => {
	it('resolves immediately for an empty target list', async () => {
		const fake = createDgramFake();
		await wakeMany([], {}, { createSocket: fake.createSocket });
		assert.equal(fake.sends.length, 0);
	});

	it('sends one packet per target using a single socket', async () => {
		const fake = createDgramFake();
		await wakeMany(
			[
				{ mac: '01:02:03:04:05:06' },
				{ mac: 'AA:BB:CC:DD:EE:FF' },
			],
			{},
			{ createSocket: fake.createSocket },
		);
		assert.equal(fake.sends.length, 2);
		assert.equal(fake.sends[0].buf.length, 102);
		assert.equal(fake.sends[1].buf.length, 102);
	});

	it('respects per-target address and port', async () => {
		const fake = createDgramFake();
		await wakeMany(
			[
				{ mac: '01:02:03:04:05:06', address: '192.168.1.255', port: 7 },
				{ mac: 'AA:BB:CC:DD:EE:FF' },
			],
			{},
			{ createSocket: fake.createSocket },
		);
		assert.equal(fake.sends[0].address, '192.168.1.255');
		assert.equal(fake.sends[0].port, 7);
		assert.equal(fake.sends[1].address, '255.255.255.255');
		assert.equal(fake.sends[1].port, 9);
	});

	it('sends correct packet content per MAC', async () => {
		const fake = createDgramFake();
		await wakeMany([{ mac: '01:02:03:04:05:06' }], {}, { createSocket: fake.createSocket });
		const packet = fake.sends[0].buf;
		for (let i = 0; i < 6; i++) assert.equal(packet[i], 0xff);
		const mac = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		assert.deepEqual(packet.subarray(6, 12), mac);
	});

	it('rejects when a send fails', async () => {
		const fake = createDgramFake();
		fake.failSend(new Error('network down'));
		await assert.rejects(
			() => wakeMany([{ mac: '01:02:03:04:05:06' }], {}, { createSocket: fake.createSocket }),
			{ message: 'network down' },
		);
	});

	it('rejects on invalid MAC without touching the socket', async () => {
		const fake = createDgramFake();
		await assert.rejects(
			() => wakeMany([{ mac: 'bad' }], {}, { createSocket: fake.createSocket }),
			/Invalid MAC address/,
		);
		assert.equal(fake.sends.length, 0);
	});
});
