#!/usr/bin/env node

import {
	parseVerifyArgs,
	decideAction,
	createLogger,
	probeSsh,
	pollUntilReachable,
	runRemote,
	sendWake,
	getVersion,
	HELP_TEXT,
} from '../src/verify.js';

const EXIT = {
	OK: 0,
	MISCONFIG: 1,
	WAKE_FAILED: 2,
	SSH_TIMEOUT: 3,
	REMEDIATION_FAILED: 4,
	VERIFY_FAILED: 5,
	USAGE: 64,
	INTERRUPTED: 130,
};

class VerifyError extends Error {
	constructor(exitCode, message) {
		super(message);
		this.exitCode = exitCode;
	}
}

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

	const onSigint = () => {
		ctrl.abort();
		log.error('interrupted');
		journal.exit = EXIT.INTERRUPTED;
		journal.durationMs = Date.now() - startedAt;
		log.json(journal);
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
			log.json(journal);
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
		log.json(journal);
		log.info(`✓ ${opts.host} ready`);
		process.exit(EXIT.OK);
	} catch (err) {
		const code = err instanceof VerifyError ? err.exitCode : EXIT.MISCONFIG;
		journal.exit = code;
		journal.durationMs = Date.now() - startedAt;
		journal.error = err.message;
		log.error(`Error: ${err.message}`);
		log.json(journal);
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

async function executePlan(plan, opts, ctx) {
	const { log, journal, total, ctrl } = ctx;
	let stepNum = 1; // 1 was the probe itself

	for (const step of plan) {
		stepNum++;
		switch (step.kind) {
			case 'noop':
				log.step(stepNum, total, step.reason ?? 'no-op');
				journal.steps.push({ kind: 'noop', reason: step.reason });
				return;

			case 'abort':
				journal.steps.push({ kind: 'abort', reason: step.reason });
				throw new VerifyError(step.exitCode, step.reason);

			case 'wake':
				log.step(stepNum, total, `Sending magic packet to ${opts.mac} via ${opts.broadcast}:${opts.port}`);
				try {
					await sendWake(opts);
					journal.steps.push({ kind: 'wake', ok: true });
				} catch (err) {
					journal.steps.push({ kind: 'wake', ok: false, error: err.message });
					throw new VerifyError(EXIT.WAKE_FAILED, `wake failed: ${err.message}`);
				}
				break;

			case 'wait': {
				log.step(stepNum, total, `Waiting for SSH (timeout=${opts.timeout}s, poll=${opts.poll}s)...`);
				const result = await pollUntilReachable(
					opts,
					(attempt, code, ms) => log.verbose(`  attempt ${attempt}: code=${code} (${ms}ms)`),
					{ signal: ctrl.signal },
				);
				journal.steps.push({
					kind: 'wait',
					ok: result.ok,
					attempts: result.attempts,
					totalMs: result.totalMs,
				});
				if (!result.ok) {
					throw new VerifyError(
						EXIT.SSH_TIMEOUT,
						`SSH never came up within ${opts.timeout}s (${result.attempts} attempts)`,
					);
				}
				log.verbose(`  SSH up after ${Math.round(result.totalMs / 1000)}s, ${result.attempts} attempts`);
				break;
			}

			case 'grace':
				if (opts.grace > 0) {
					log.step(stepNum, total, `Grace ${opts.grace}s to settle`);
					await sleep(opts.grace * 1000, ctrl.signal);
					journal.steps.push({ kind: 'grace', seconds: opts.grace });
				} else {
					stepNum--; // skip step number bump if we didn't actually do anything
				}
				break;

			case 'remediate':
				if (!opts.remediate) {
					stepNum--;
					continue;
				}
				log.step(stepNum, total, `Running remediation: ${opts.remediate}`);
				{
					const r = await runRemote(opts, opts.remediate, { signal: ctrl.signal });
					log.debug(`remediate: code=${r.code} stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`);
					journal.steps.push({ kind: 'remediate', code: r.code, durationMs: r.durationMs });
					if (r.code !== 0) {
						throw new VerifyError(
							EXIT.REMEDIATION_FAILED,
							`remediation failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`,
						);
					}
				}
				break;

			case 'verify':
				if (!opts.verifyCmd) {
					stepNum--;
					continue;
				}
				log.step(stepNum, total, `Verifying: ${opts.verifyCmd}`);
				{
					const r = await runRemote(opts, opts.verifyCmd, { signal: ctrl.signal });
					log.debug(`verify: code=${r.code} stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`);
					journal.steps.push({ kind: 'verify', code: r.code, durationMs: r.durationMs });
					if (r.code !== 0) {
						throw new VerifyError(
							EXIT.VERIFY_FAILED,
							`verification failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`,
						);
					}
				}
				break;

			default:
				throw new Error(`Unknown step kind: ${step.kind}`);
		}
	}
}

function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		if (signal) {
			signal.addEventListener('abort', () => {
				clearTimeout(t);
				reject(new Error('aborted'));
			});
		}
	});
}

main().catch((err) => {
	process.stderr.write(`Fatal: ${err.message}\n`);
	process.exit(EXIT.MISCONFIG);
});
