// config.json: global settings for every child.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Config = {
	/** Language the parent writes tasks in. */
	promptLanguage: string;
	/** Appended to every task. */
	taskNote: string;
	/** Heading above the `doc-paths` list in the task. */
	docPathsIntro: string;
	/** pi arguments for every child. */
	args: string[];
	/** The only extensions a child loads: paths relative to the pi agent dir, or builtin:<name>. */
	extensions: string[];
};

/** Read on every use, so edits apply without /reload. */
export function loadConfig(): Config {
	return JSON.parse(readFileSync(join(import.meta.dirname, "config.json"), "utf8")) as Config;
}
