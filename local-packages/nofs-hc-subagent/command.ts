// The pi command line a child starts with.
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Agent } from "./agents.ts";
import type { Config } from "./config.ts";

export type Command = { command: string; args: string[] };

export type ChildSpec = {
	agent: Agent;
	task: string;
	cwd: string;
	/** Exact provider/id. */
	model: string;
	thinking?: string;
};

/** Windows caps a command line at 32,767 characters; leave room for quoting. */
const MAX_COMMAND_LINE = 32_000;

/**
 * pi run by the same node and CLI script as this parent, with only the
 * configured extensions plus child.ts, which reports the final reply.
 * Throws when a document or extension is missing or the command is too long.
 */
export function childCommand(spec: ChildSpec, config: Config, agentDir: string): Command {
	const { agent } = spec;
	for (const file of [...agent.docs, ...agent.docPaths]) {
		if (!existsSync(resolve(spec.cwd, file))) throw new Error(`document not found: ${file}`);
	}

	const args = [process.argv[1], ...config.args, "--no-extensions"];
	for (const ext of config.extensions) {
		const path = ext.startsWith("builtin:") || isAbsolute(ext) ? ext : join(agentDir, ext);
		if (!ext.startsWith("builtin:") && !existsSync(path)) throw new Error(`config.json: extension not found: ${path}`);
		args.push("-e", path);
	}
	args.push("-e", join(import.meta.dirname, "child.ts"), "--model", spec.model);
	if (spec.thinking) args.push("--thinking", spec.thinking);
	if (agent.tools.length) args.push("--tools", agent.tools.join(","));
	// pi reads @files itself, so document contents never go on the command line.
	args.push("--", ...agent.docs.map((doc) => `@${doc}`), taskMessage(spec, config));

	const length = [process.execPath, ...args].reduce((sum, arg) => sum + arg.length + 3, 0);
	if (length > MAX_COMMAND_LINE) {
		throw new Error(`the command line would be ${length} characters (limit ${MAX_COMMAND_LINE}); shorten the task`);
	}
	return { command: process.execPath, args };
}

/** The first message: documents to read, the task, the task note. */
export function taskMessage(spec: ChildSpec, config: Config): string {
	const parts: string[] = [];
	if (spec.agent.docPaths.length) parts.push([config.docPathsIntro, ...spec.agent.docPaths.map((path) => `- ${path}`)].join("\n"));
	parts.push(spec.task.trim(), config.taskNote);
	const text = parts.filter(Boolean).join("\n\n");
	// pi would read a message starting with "@" as a file.
	return text.startsWith("@") ? ` ${text}` : text;
}
