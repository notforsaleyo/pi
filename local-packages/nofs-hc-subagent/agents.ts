// Agent definitions: <cwd>/.pi/agents/<name>.md. Only the frontmatter is used;
// the body is not sent to the child.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Agent = {
	name: string;
	description: string;
	/** Defaults; a call may override both. The model may be a loose name like "opus". */
	model: string;
	thinking?: string;
	/** pi --tools; empty means pi's default tools. */
	tools: string[];
	/** Project-relative files attached to the task as @file. */
	docs: string[];
	/** Project-relative files listed in the task for the child to read. */
	docPaths: string[];
};

export type AgentScan = {
	agents: Map<string, Agent>;
	/** "file.md: reason" for definitions that cannot be used. */
	skipped: string[];
};

/** Undefined when the project has no agent directory. */
export function scanAgents(cwd: string): AgentScan | undefined {
	const dir = join(cwd, ".pi", "agents");
	if (!existsSync(dir)) return undefined;
	const scan: AgentScan = { agents: new Map(), skipped: [] };
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
		const fields = frontmatter(readFileSync(join(dir, file), "utf8"));
		if (!fields.model) {
			scan.skipped.push(`${file}: no model`);
			continue;
		}
		const name = file.slice(0, -".md".length);
		scan.agents.set(name, {
			name,
			description: fields.description ?? "",
			model: fields.model,
			thinking: fields.thinking || undefined,
			tools: list(fields.tools),
			docs: list(fields.docs),
			docPaths: list(fields["doc-paths"]),
		});
	}
	return scan;
}

/** Flat `key: value` lines between the leading `---` fences. Other keys and indented lines are ignored. */
export function frontmatter(text: string): Record<string, string> {
	const block = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text)?.[1] ?? "";
	const fields: Record<string, string> = {};
	for (const line of block.split(/\r?\n/)) {
		if (!line || /^[\s#]/.test(line)) continue;
		const colon = line.indexOf(":");
		if (colon > 0) fields[line.slice(0, colon).trim()] = unquote(line.slice(colon + 1).trim());
	}
	return fields;
}

/** `a, b` or `[a, b]`. */
function list(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((item) => unquote(item.trim()))
		.filter(Boolean);
}

function unquote(value: string): string {
	return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}
