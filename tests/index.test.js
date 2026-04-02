import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMAC, isValidMAC, createMagicPacket } from '../src/index.js';

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
