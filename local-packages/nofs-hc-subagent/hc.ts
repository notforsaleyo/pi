// The herdr-core CLI (`hc`).
import { execFile } from "node:child_process";

export type Terminal = {
	address: string;
	/** "live" while the program runs. */
	state: string;
	exit_code?: number | null;
	status?: { state?: string; msg?: string } | null;
};

function hc(args: string[], signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("hc", args, { signal, timeout: 20_000, maxBuffer: 8 << 20 }, (error, stdout, stderr) => {
			if (!error) return resolve(stdout);
			if (signal?.aborted) return reject(signal.reason);
			reject(new Error(`hc ${args[0]}: ${(stderr || stdout || error.message).trim()}`));
		});
	});
}

/**
 * Start `argv` in a background terminal under `parent`. Undefined when the name
 * is taken. Not abortable: an aborted `hc run` could leave a terminal behind
 * whose address was never returned.
 */
export async function startTerminal(options: { name: string; parent: string; cwd: string; argv: string[] }): Promise<string | undefined> {
	const { name, parent, cwd, argv } = options;
	try {
		const out = await hc(["run", "--bg", "--json", "--no-notify", "--name", name, "--parent", parent, "--cwd", cwd, "--", ...argv]);
		return (JSON.parse(out) as Terminal).address;
	} catch (error) {
		if (String(error).includes('"name_taken"')) return undefined;
		throw error;
	}
}

export async function getTerminal(terminal: string, signal?: AbortSignal): Promise<Terminal> {
	return JSON.parse(await hc(["get", terminal, "--json"], signal)) as Terminal;
}

/** The screen plus `lines` of history, as text. */
export function readScreen(terminal: string, lines: number): Promise<string> {
	return hc(["read", terminal, "--lines", String(lines)]);
}

/** End the program and drop the terminal. Never throws. */
export async function removeTerminal(terminal: string): Promise<void> {
	await hc(["kill", terminal, "--json"]).catch(() => {});
	await hc(["rm", terminal, "--json"]).catch(() => {});
}
