#!/usr/bin/env node

import { wake, isValidMAC } from '../src/index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion() {
	const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));
	return pkg.version;
}

function printHelp() {
	console.log(`Usage: oi-wake-up [options] <mac> [mac...]

Arguments:
  mac                    MAC address(es) to wake

Options:
  -i, --address <ip>     Destination IP (default: "255.255.255.255")
  -p, --port <number>    Destination port (default: 9)
  -q, --quiet            Suppress output
  -f, --file <path>      Read MAC addresses from file
  -d, --delay <ms>       Delay between packets in ms (default: 0)
  -v, --version          Show version
  -h, --help             Show help`);
}

function readMACsFromFile(filePath) {
	let content;
	try {
		content = readFileSync(resolve(filePath), 'utf8');
	} catch (err) {
		console.error(`Error: Cannot read file: ${filePath}`);
		process.exit(1);
	}

	const entries = [];
	const lines = content.split('\n');

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const parts = trimmed.split(/\s+/);
		entries.push({
			mac: parts[0],
			address: parts[1] || undefined,
			port: parts[2] ? parseInt(parts[2], 10) : undefined,
		});
	}

	return entries;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		printHelp();
		process.exit(1);
	}

	const options = {
		address: '255.255.255.255',
		port: 9,
		quiet: false,
		file: null,
		delay: 0,
	};
	const macs = [];

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '-h':
			case '--help':
				printHelp();
				process.exit(0);
				break;
			case '-v':
			case '--version':
				console.log(getVersion());
				process.exit(0);
				break;
			case '-i':
			case '--address':
				options.address = args[++i];
				if (!options.address) {
					console.error('Error: --address requires an IP argument');
					process.exit(1);
				}
				break;
			case '-p':
			case '--port': {
				const portStr = args[++i];
				const port = parseInt(portStr, 10);
				if (Number.isNaN(port) || port < 0 || port > 65535) {
					console.error(`Invalid port: ${portStr}`);
					process.exit(1);
				}
				options.port = port;
				break;
			}
			case '-q':
			case '--quiet':
				options.quiet = true;
				break;
			case '-f':
			case '--file':
				options.file = args[++i];
				if (!options.file) {
					console.error('Error: --file requires a path argument');
					process.exit(1);
				}
				break;
			case '-d':
			case '--delay': {
				const delayStr = args[++i];
				const delay = parseInt(delayStr, 10);
				if (Number.isNaN(delay) || delay < 0) {
					console.error(`Error: Invalid delay: ${delayStr}`);
					process.exit(1);
				}
				options.delay = delay;
				break;
			}
			default:
				macs.push(args[i]);
		}
	}

	// Collect targets from file if specified
	const targets = [];

	if (options.file) {
		const fileEntries = readMACsFromFile(options.file);
		if (fileEntries.length === 0) {
			console.error('No MAC addresses found');
			process.exit(1);
		}
		for (const entry of fileEntries) {
			targets.push({
				mac: entry.mac,
				address: entry.address || options.address,
				port: entry.port ?? options.port,
			});
		}
	}

	// Add CLI MAC arguments
	for (const mac of macs) {
		targets.push({
			mac,
			address: options.address,
			port: options.port,
		});
	}

	if (targets.length === 0) {
		printHelp();
		process.exit(1);
	}

	// Separate valid and invalid
	const valid = [];
	const invalid = [];

	for (const target of targets) {
		if (isValidMAC(target.mac)) {
			valid.push(target);
		} else {
			invalid.push(target);
		}
	}

	// Warn about invalid MACs
	for (const target of invalid) {
		console.error(`Warning: Invalid MAC address: ${target.mac}`);
	}

	if (valid.length === 0) {
		process.exit(1);
	}

	// Send packets
	for (let i = 0; i < valid.length; i++) {
		if (i > 0 && options.delay > 0) {
			await sleep(options.delay);
		}

		try {
			await wake(valid[i].mac, {
				address: valid[i].address,
				port: valid[i].port,
			});
			if (!options.quiet) {
				console.log(`Magic packet sent to ${valid[i].mac}`);
			}
		} catch (err) {
			console.error(`Error sending to ${valid[i].mac}: ${err.message}`);
			process.exit(1);
		}
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
