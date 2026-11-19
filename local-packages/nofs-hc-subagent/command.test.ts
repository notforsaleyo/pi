import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scanAgents } from "./agents.ts";
import { childCommand, taskMessage, type ChildSpec } from "./command.ts";
import type { Config } from "./config.ts";

const config: Config = {
	promptLanguage: "English",
	taskNote: "NOTE",
	docPathsIntro: "Read first:",
	args: ["--no-session"],
	extensions: ["builtin:codemode", "ext/a.ts"],
};

function project(t: { after(fn: () => void): void }): string {
	const dir = mkdtempSync(join(tmpdir(), "nofs-hc-subagent-test-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
	mkdirSync(join(dir, "docs"));
	mkdirSync(join(dir, "ext"));
	writeFileSync(join(dir, "docs", "a.md"), "a");
	writeFileSync(join(dir, "docs", "b.md"), "b");
	writeFileSync(join(dir, "ext", "a.ts"), "");
	return dir;
}

test("agents come from frontmatter only", (t) => {
	const dir = project(t);
	const agents = join(dir, ".pi", "agents");
	writeFileSync(
		join(agents, "rev.md"),
		[
			"---",
			"name: ignored",
			'description: "Reviews: diffs"',
			"model: opus",
			"thinking: high",
			"tools: [read, grep]",
			"docs: docs/a.md",
			"doc-paths: 'docs/b.md'",
			"sessionHint: ignored",
			"  indented: ignored",
			"---",
			"Body is not used.",
		].join("\r\n"),
	);
	writeFileSync(join(agents, "bad.md"), "---\ndescription: x\n---\n");
	writeFileSync(join(agents, "notes.txt"), "---\nmodel: x\n---\n");

	const scan = scanAgents(dir)!;
	assert.deepEqual([...scan.agents.keys()], ["rev"]);
	assert.deepEqual(scan.agents.get("rev"), {
		name: "rev",
		description: "Reviews: diffs",
		model: "opus",
		thinking: "high",
		tools: ["read", "grep"],
		docs: ["docs/a.md"],
		docPaths: ["docs/b.md"],
	});
	assert.deepEqual(scan.skipped, ["bad.md: no model"]);
	assert.equal(scanAgents(join(dir, "docs")), undefined);
});

function spec(cwd: string, overrides: Partial<ChildSpec["agent"]> = {}, task = "Do it."): ChildSpec {
	return {
		agent: { name: "rev", description: "", model: "opus", tools: [], docs: [], docPaths: [], ...overrides },
		task,
		cwd,
		model: "anthropic/claude-opus-5-5",
		thinking: "high",
	};
}

test("the command loads only the allowlist and child.ts, and attaches docs", (t) => {
	const dir = project(t);
	const { command, args } = childCommand(spec(dir, { tools: ["read", "grep"], docs: ["docs/a.md"] }), config, dir);
	assert.equal(command, process.execPath);
	assert.deepEqual(args.slice(1), [
		"--no-session",
		"--no-extensions",
		"-e", "builtin:codemode",
		"-e", join(dir, "ext/a.ts"),
		"-e", join(import.meta.dirname, "child.ts"),
		"--model", "anthropic/claude-opus-5-5",
		"--thinking", "high",
		"--tools", "read,grep",
		"--",
		"@docs/a.md",
		"Do it.\n\nNOTE",
	]);
});

test("missing documents, missing extensions and long tasks are refused", (t) => {
	const dir = project(t);
	assert.throws(() => childCommand(spec(dir, { docPaths: ["docs/nope.md"] }), config, dir), /document not found: docs\/nope.md/);
	assert.throws(() => childCommand(spec(dir), config, join(dir, "elsewhere")), /extension not found/);
	assert.throws(() => childCommand(spec(dir, {}, "x".repeat(40_000)), config, dir), /command line would be/);
});

test("the message lists doc-paths, then the task, then the note", (t) => {
	const dir = project(t);
	assert.equal(
		taskMessage(spec(dir, { docPaths: ["docs/a.md", "docs/b.md"] }, "  Review.\n"), config),
		"Read first:\n- docs/a.md\n- docs/b.md\n\nReview.\n\nNOTE",
	);
	assert.equal(taskMessage(spec(dir, {}, "@x look"), config), " @x look\n\nNOTE");
});
