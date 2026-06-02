#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import {
	parseVerifyArgs,
	decideAction,
	createLogger,
	probeSsh,
	executePlan,
	getVersion,
	HELP_TEXT,
	VerifyError,
	EXIT,
} from '../src/verify.js';

async function main() {
	let opts;
	try {
		opts = parseVerifyArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`Error: ${err.message}\n`);
		process.stderr.write(`Run \`oi-wake-verify --help\` for usage.\n`);
		process.exit(EXIT.USAGE);
	}

	if (opts.help) {
		process.stdout.write(HELP_TEXT + '\n');
		process.exit(EXIT.OK);
	}
	if (opts.version) {
		process.stdout.write(getVersion() + '\n');
		process.exit(EXIT.OK);
	}

	const log = createLogger(opts.level, opts.json);
	const ctrl = new AbortController();
	const startedAt = Date.now();
	const journal = {
		host: opts.host,
		state: null,
		steps: [],
		exit: EXIT.OK,
		durationMs: 0,
	};

	const flushJournal = () => {
		log.json(journal);
		if (opts.journal) {
			appendFileSync(opts.journal, JSON.stringify(journal) + '\n');
		}
	};

	const onSigint = () => {
		ctrl.abort();
		log.error('interrupted');
		journal.exit = EXIT.INTERRUPTED;
		journal.durationMs = Date.now() - startedAt;
		flushJournal();
		process.exit(EXIT.INTERRUPTED);
	};
	process.on('SIGINT', onSigint);

	try {
		// Dry-run: don't probe, just print the plans.
		if (opts.dryRun) {
			log.info('Dry-run — no actions performed.');
			log.info('If unreachable: wake → wait for SSH → grace → remediate → verify.');
			log.info('If reachable (default): no action.');
			if (opts.remediate) log.info(`  remediation: ${opts.remediate}`);
			if (opts.verifyCmd) log.info(`  verify: ${opts.verifyCmd}`);
			journal.state = 'dry-run';
			journal.steps = ['probe', 'wake', 'wait', 'grace', 'remediate', 'verify'];
			journal.durationMs = Date.now() - startedAt;
			flushJournal();
			process.exit(EXIT.OK);
		}

		// Pre-flight probe.
		log.verbose(`Probing ${displayTarget(opts)} (probe-timeout=${opts.probeTimeout}s)...`);
		const probe = await probeSsh(opts, { signal: ctrl.signal });
		const state = probe.reachable ? 'reachable' : 'unreachable';
		journal.state = state;
		log.debug(`probe: code=${probe.code} duration=${probe.durationMs}ms stderr=${probe.stderr.trim()}`);

		const plan = decideAction(state, opts);
		const total = plan.length + 1; // include the probe itself in step count
		log.step(1, total, `Probed ${opts.host} → ${state}`);

		await executePlan(plan, opts, { log, journal, total, ctrl });

		journal.exit = EXIT.OK;
		journal.durationMs = Date.now() - startedAt;
		flushJournal();
		log.info(`✓ ${opts.host} ready`);
		process.exit(EXIT.OK);
	} catch (err) {
		const code = err instanceof VerifyError ? err.exitCode : EXIT.MISCONFIG;
		journal.exit = code;
		journal.durationMs = Date.now() - startedAt;
		journal.error = err.message;
		log.error(`Error: ${err.message}`);
		flushJournal();
		process.exit(code);
	} finally {
		process.off('SIGINT', onSigint);
	}
}

function displayTarget(opts) {
	const u = opts.user ? `${opts.user}@` : '';
	const p = opts.sshPort && opts.sshPort !== 22 ? `:${opts.sshPort}` : '';
	return `${u}${opts.host}${p}`;
}

main().catch((err) => {
	process.stderr.write(`Fatal: ${err.message}\n`);
	process.exit(EXIT.MISCONFIG);
});
