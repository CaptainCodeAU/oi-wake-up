#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import {
	parseSleepArgs,
	decideSleepAction,
	executeSleepPlan,
	createLogger,
	probeSsh,
	getVersion,
	HELP_TEXT,
	SleepError,
	EXIT,
} from '../src/sleep.js';

async function main() {
	let opts;
	try {
		opts = parseSleepArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`Error: ${err.message}\n`);
		process.stderr.write(`Run \`oi-wake-down --help\` for usage.\n`);
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
		// Dry-run: don't probe, just print both plans.
		if (opts.dryRun) {
			log.info('Dry-run — no actions performed.');
			log.info('If reachable: send sleep command → confirm asleep.');
			log.info('If already asleep: no action.');
			log.info(`  command: ${opts.command}`);
			journal.state = 'dry-run';
			journal.steps = ['sleep-cmd', 'confirm-asleep'];
			journal.durationMs = Date.now() - startedAt;
			flushJournal();
			process.exit(EXIT.OK);
		}

		// Pre-flight probe.
		log.verbose(`Probing ${opts.host} (probe-timeout=${opts.probeTimeout}s)...`);
		const probe = await probeSsh(opts, { signal: ctrl.signal });
		const state = probe.reachable ? 'reachable' : 'unreachable';
		journal.state = state;
		log.debug(`probe: code=${probe.code} duration=${probe.durationMs}ms stderr=${probe.stderr.trim()}`);

		const plan = decideSleepAction(state, opts);
		const total = plan.length + 1; // include probe in step count
		log.step(1, total, `Probed ${opts.host} → ${state}`);

		await executeSleepPlan(plan, opts, { log, journal, total, ctrl });

		journal.exit = EXIT.OK;
		journal.durationMs = Date.now() - startedAt;
		flushJournal();
		log.info(`✓ ${opts.host} asleep`);
		process.exit(EXIT.OK);
	} catch (err) {
		const code = err instanceof SleepError ? err.exitCode : EXIT.MISCONFIG;
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

main().catch((err) => {
	process.stderr.write(`Fatal: ${err.message}\n`);
	process.exit(EXIT.MISCONFIG);
});
