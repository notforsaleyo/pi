import assert from "node:assert/strict";
import { test } from "node:test";
import agentModes from "./index.ts";

test("subagents register no mode hooks or shortcuts at any positive depth", (t) => {
	const original = process.env.PI_SUBAGENT_DEPTH;
	t.after(() => {
		if (original === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = original;
	});
	for (const depth of ["1", "2", "3"]) {
		process.env.PI_SUBAGENT_DEPTH = depth;
		agentModes(new Proxy({}, {
			get: (_target, key) => assert.fail(`child must not access ExtensionAPI.${String(key)}`),
		}) as any);
	}
});

test("parent retains mode prompt, reminders, restoration and Shift+Tab", async (t) => {
	const original = process.env.PI_SUBAGENT_DEPTH;
	t.after(() => {
		if (original === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = original;
	});
	for (const depth of [undefined, "0"]) {
		if (depth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
		else process.env.PI_SUBAGENT_DEPTH = depth;
		const hooks: Record<string, any> = {};
		let cycle: any;
		const entries: any[] = [];
		agentModes({
			on: (name: string, handler: any) => { hooks[name] = handler; },
			registerShortcut: (key: string, options: any) => {
				assert.equal(key, "shift+tab");
				cycle = options.handler;
			},
			appendEntry: (customType: string, data: any) => entries.push({
				type: "custom", customType, data, timestamp: new Date(1).toISOString(),
			}),
		} as any);
		const ctx = { hasUI: false, sessionManager: { getEntries: () => entries } };
		hooks.session_start({}, ctx);
		const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
		hooks.before_agent_start(event);
		assert.match(event.systemPromptOptions.sections.agent_modes, /PLAN, SPEC, BASH/);
		const message = { role: "user", content: "Task", timestamp: 10 };
		const mode = () => hooks.context({ messages: [message] }, ctx).messages[0].content.at(-1).text;
		assert.match(mode(), /Current mode: PLAN/);
		for (const expected of ["SPEC", "BASH", "PLAN"]) {
			await cycle(ctx);
			assert.match(mode(), new RegExp(`Current mode: ${expected}`));
		}
		await cycle(ctx);
		hooks.session_start({}, ctx);
		await cycle(ctx);
		assert.match(mode(), /Current mode: BASH/, "restored SPEC must cycle to BASH");
		assert.equal(message.content, "Task");
	}
});
