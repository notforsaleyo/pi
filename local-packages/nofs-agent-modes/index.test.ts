import assert from "node:assert/strict";
import { test } from "node:test";
import agentModes, { annotateMessages, resolveSubagentMode } from "./index.ts";

const childEnv = (role: string, mode?: string): NodeJS.ProcessEnv => ({
	PI_SUBAGENT_DEPTH: "1", PI_SUBAGENT_STACK: JSON.stringify([role]), PI_AGENT_MODE: mode,
});

test("only workers inherit the parent's valid mode", () => {
	for (const mode of ["plan", "spec", "bash"]) {
		assert.equal(resolveSubagentMode(childEnv("worker", mode)), mode);
		for (const role of ["explore", "reviewer", "unknown"]) {
			assert.equal(resolveSubagentMode(childEnv(role, mode)), "plan");
		}
	}
	assert.equal(resolveSubagentMode({ ...childEnv("worker", "spec"),
		PI_SUBAGENT_DEPTH: "2", PI_SUBAGENT_STACK: '["explore","worker"]' }), "spec");
	assert.equal(resolveSubagentMode({ PI_AGENT_MODE: "bash" }), undefined);
	assert.equal(resolveSubagentMode({}), undefined);
});

test("missing or invalid child metadata falls back to PLAN", () => {
	for (const mode of [undefined, "", "BASH", "invalid", "constructor", "__proto__"]) {
		assert.equal(resolveSubagentMode(childEnv("worker", mode)), "plan");
	}
	for (const stack of [undefined, "", "{", "null", '"worker"', "{}", "[]", "[42]"]) {
		assert.equal(resolveSubagentMode({ ...childEnv("worker", "bash"), PI_SUBAGENT_STACK: stack }), "plan");
	}
	for (const depth of [undefined, "", "0", "-1", "1.5", "Infinity", "invalid"]) {
		assert.equal(resolveSubagentMode({ ...childEnv("worker", "bash"), PI_SUBAGENT_DEPTH: depth }), "plan");
	}
});

function harness(entries: any[] = [], hasUI = false) {
	const handlers: Record<string, (...args: any[]) => any> = {};
	let shortcut: any;
	let now = 100;
	const widgets: any[] = [];
	const ctx = { hasUI, sessionManager: { getEntries: () => entries },
		ui: { setWidget: (...args: any[]) => widgets.push(args) } };
	agentModes({
		on: (event: string, handler: any) => { handlers[event] = handler; },
		registerShortcut: (key: string, options: any) => {
			assert.equal(key, "shift+tab");
			shortcut = options.handler;
		},
		appendEntry: (customType: string, data: unknown) => entries.push({
			type: "custom", customType, data, timestamp: new Date(now++).toISOString(),
		}),
	} as any);
	return { entries, handlers, widgets, start: () => handlers.session_start({}, ctx),
		cycle: () => shortcut(ctx), context: (messages: any[]) => handlers.context({ messages }, ctx).messages };
}

function setEnv(env: NodeJS.ProcessEnv) {
	for (const key of ["PI_AGENT_MODE", "PI_SUBAGENT_DEPTH", "PI_SUBAGENT_STACK"]) {
		if (env[key] === undefined) delete process.env[key];
		else process.env[key] = env[key];
	}
}

test("parent restore, headless export, Shift+Tab and reload retain normal behavior", async (t) => {
	const original = { ...process.env };
	t.after(() => setEnv(original));
	setEnv({ PI_AGENT_MODE: "bash" });
	const fresh = harness();
	fresh.start();
	assert.equal(process.env.PI_AGENT_MODE, "plan", "root must ignore stale inherited environment");
	assert.equal(fresh.entries.length, 0);
	for (const mode of ["spec", "bash", "plan"]) {
		await fresh.cycle();
		assert.equal(process.env.PI_AGENT_MODE, mode);
		assert.equal(fresh.entries.at(-1).data.mode, mode);
	}
	const entries = [{ type: "custom", customType: "agent-mode", data: { mode: "spec" } }];
	const restored = harness(entries, true);
	restored.start();
	assert.equal(process.env.PI_AGENT_MODE, "spec");
	assert.equal((globalThis as any).__piAgentMode.id, "spec");
	assert.equal(restored.widgets.length, 1);
	await restored.cycle();
	assert.equal(process.env.PI_AGENT_MODE, "bash");
	harness(entries).start();
	assert.equal(process.env.PI_AGENT_MODE, "bash", "reload restores persisted mode");
});

test("fresh and continued children record invocation mode without rewriting old reminders", (t) => {
	const original = { ...process.env };
	t.after(() => setEnv(original));
	setEnv(childEnv("worker", "bash"));
	const fresh = harness();
	fresh.start();
	assert.equal(fresh.entries.at(-1).data.mode, "bash");
	const oldUser = { role: "user", content: "Earlier task", timestamp: 50 };
	const oldEntry = { type: "custom", customType: "agent-mode", data: { mode: "bash" },
		timestamp: new Date(10).toISOString() };
	for (const [role, incoming, expected] of [
		["worker", "plan", "plan"], ["worker", "spec", "spec"],
		["reviewer", "bash", "plan"], ["explore", "bash", "plan"],
		["worker", undefined, "plan"],
	]) {
		setEnv(childEnv(role!, incoming));
		const continued = harness([oldEntry]);
		const before = continued.context([oldUser]);
		continued.start();
		assert.equal(continued.entries.at(-1).data.mode, expected);
		assert.equal(process.env.PI_AGENT_MODE, expected);
		const after = continued.context([oldUser, { role: "user", content: "New task", timestamp: 200 }]);
		assert.deepEqual(after[0], before[0]);
		assert.equal(after[1].content.at(-1).text, `<system-reminder>Current mode: ${expected!.toUpperCase()}</system-reminder>`);
		assert.equal(oldUser.content, "Earlier task", "stored messages must remain untouched");
	}
});

test("mid-turn reminders remain stable after later mode changes", () => {
	const messages = [
		{ role: "user", content: "Task", timestamp: 10 },
		{ role: "assistant", content: [], timestamp: 20 },
		{ role: "toolResult", content: [], timestamp: 40 },
	];
	const changes = [{ at: 0, mode: "bash" as const }, { at: 30, mode: "plan" as const }];
	const before = annotateMessages(messages, changes);
	assert.match(before[0].content.at(-1).text, /BASH/);
	assert.match(before[2].content.at(-1).text, /PLAN/);
	assert.deepEqual(annotateMessages(messages, [...changes, { at: 60, mode: "spec" }]), before);
});
