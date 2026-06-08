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
		ts: new Date(startedAt).toISOString(),
		host: opts.host,
		state: null,
		steps: [],
		exit: EXIT.OK,
		durationMs: 0,
	};

	const flushJournal = () => {
		// finishedAt is recomputed on every flush so it is present and accurate
		// on all exit paths (success, error, dry-run, and the signal-kill flush).
		journal.finishedAt = new Date().toISOString();
		log.json(journal);
		if (opts.journal) {
			appendFileSync(opts.journal, JSON.stringify(journal) + '\n');
		}
	};

	// Flush the journal on a signal-kill too. A parent that times us out (cron
	// wrapper, dispatcher's execFile, systemd) sends SIGTERM; with no handler
	// Node terminates silently and the --json/--journal record is never written
	// — leaving zero trace of which step was in flight. Treat SIGTERM/SIGHUP
	// like SIGINT so the journal still names the stalled step.
	const onSignal = (sig) => {
		ctrl.abort();
		log.error(`interrupted (${sig})`);
		journal.exit = EXIT.INTERRUPTED;
		journal.durationMs = Date.now() - startedAt;
		flushJournal();
		process.exit(EXIT.INTERRUPTED);
	};
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);
	process.on('SIGHUP', onSignal);

	try {
		// Dry-run: don't probe, just print the plans.
		if (opts.dryRun) {
			log.info('Dry-run — no actions performed.');
			log.info('If unreachable: wake → wait for SSH → grace → remediate → verify.');
			log.info('If reachable (default): no action.');
			if (opts.remediate) log.info(`  remediation: ${opts.remediate}`);
			if (opts.verifyCmd) log.info(`  verify: ${opts.verifyCmd}`);
			if (opts.captureWakeSource) log.info('  wake-source: powercfg /lastwake captured after wake');
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
		// Surface the probe's failure reason at default verbosity (not just -d):
		// host-key mismatch, connection timeout, refused, and sshd-down each
		// have different fixes, and users shouldn't need debug mode to see which.
		if (!probe.reachable && probe.stderr.trim()) {
			log.info(`  probe: ${probe.stderr.trim()}`);
		}

		// --status: probe-only liveness. Report reachability and exit 0 even when
		// unreachable (it's a query, not a wake). No wake/remediate/wakeSource.
		if (opts.status) {
			journal.exit = EXIT.OK;
			journal.durationMs = Date.now() - startedAt;
			flushJournal();
			log.info(`${opts.host}: ${state}`);
			process.exit(EXIT.OK);
		}

		const plan = decideAction(state, opts);
		const performedWake = plan.some((s) => s.kind === 'wake');
		const total = plan.length + 1; // include the probe itself in step count
		log.step(1, total, `Probed ${opts.host} → ${state}`);

		await executePlan(plan, opts, { log, journal, total, ctrl });

		// If --capture-wake-source was set but executePlan never captured (no
		// post-wake SSH session reached), record WHY — so the consumer can tell
		// "no wake performed" apart from "captured: external device". A reachable
		// run must NOT report a stale prior /lastwake; --wake-only has no session.
		if (opts.captureWakeSource && !journal.wakeSource) {
			journal.wakeSource = performedWake
				? { performedWake: true, captured: false, reason: 'wake-only — no SSH session to query lastwake' }
				: { performedWake: false, captured: false, reason: 'host already reachable — no wake performed' };
		}

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
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
		process.off('SIGHUP', onSignal);
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
