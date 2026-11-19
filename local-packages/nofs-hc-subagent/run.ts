// Run one child in a herdr terminal under the parent, wait for its result
// file, and remove the terminal.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildResult } from "./child.ts";
import type { Command } from "./command.ts";
import { getTerminal, readScreen, removeTerminal, startTerminal } from "./hc.ts";

export type Outcome = { ok: boolean; text: string };

/** Job and result files of running children. */
const WORK_DIR = join(tmpdir(), "nofs-hc-subagent");
const NAME_MAX = 32;
const POLL_MS = 1000;

export async function runChild(options: {
	/** Terminal name; `-2`, `-3`... is added while it is taken. */
	name: string;
	cwd: string;
	command: Command;
	parent: string;
	signal?: AbortSignal;
	onStatus: (line: string) => void;
}): Promise<Outcome> {
	const { cwd, command, parent, signal, onStatus } = options;
	mkdirSync(WORK_DIR, { recursive: true });
	const id = randomUUID();
	const jobPath = join(WORK_DIR, `${id}.job.json`);
	const resultPath = join(WORK_DIR, `${id}.result.json`);
	const env = { NOFS_HC_RESULT: resultPath, PI_SUBAGENT_DEPTH: "1" };
	writeFileSync(jobPath, JSON.stringify({ ...command, env }));

	let terminal: string | undefined;
	try {
		const argv = [process.execPath, join(import.meta.dirname, "launcher.mjs"), jobPath];
		const base = terminalName(options.name);
		let name = base;
		for (let n = 2; ; n++) {
			terminal = await startTerminal({ name, parent, cwd, argv });
			if (terminal) break;
			if (n > 99) throw new Error(`no free terminal name for ${base}`);
			name = `${base}-${n}`;
		}
		return await waitForResult(terminal, name, resultPath, signal, onStatus);
	} finally {
		if (terminal) await removeTerminal(terminal);
		rmSync(jobPath, { force: true });
		rmSync(resultPath, { force: true });
	}
}

/** hc names: 1-32 of a-z 0-9 - _, with room for a `-NN` suffix. */
function terminalName(name: string): string {
	const clean = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	return clean.slice(0, NAME_MAX - 3) || "subagent";
}

/**
 * The result file marks completion. Terminal status only feeds the progress
 * line; herdr reports idle before the task starts, so it cannot. A blocked
 * child is shown and waited on, not failed.
 */
async function waitForResult(
	terminal: string,
	name: string,
	resultPath: string,
	signal: AbortSignal | undefined,
	onStatus: (line: string) => void,
): Promise<Outcome> {
	let shown = "";
	while (true) {
		if (existsSync(resultPath)) return outcome(JSON.parse(readFileSync(resultPath, "utf8")) as ChildResult);
		const t = await getTerminal(terminal, signal);
		if (t.state !== "live") return exitedEarly(terminal, t);
		const status = t.status?.state ?? "starting";
		const line = status === "blocked" ? `${name} blocked: ${t.status?.msg || "waiting for input"} (answer it in herdr)` : `${name} ${status}`;
		if (line !== shown) onStatus((shown = line));
		await sleep(POLL_MS, signal);
	}
}

function outcome(result: ChildResult): Outcome {
	const text = result.text || "(empty reply)";
	return result.error ? { ok: false, text: `${text}\n\n[error] ${result.error}` } : { ok: true, text };
}

async function exitedEarly(terminal: string, t: { exit_code?: number | null }): Promise<Outcome> {
	const screen = (await readScreen(terminal, 20).catch(() => "")).trim();
	const parts = [`The child exited (code ${t.exit_code ?? "unknown"}) before it replied.`];
	if (screen) parts.push(`Last screen:\n${screen}`);
	return { ok: false, text: parts.join("\n\n") };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		signal?.throwIfAborted();
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
