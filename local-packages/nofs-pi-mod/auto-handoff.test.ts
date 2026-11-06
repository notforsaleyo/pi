import assert from "node:assert/strict";
import { test } from "node:test";
import { handoffThreshold, nextHandoffName, parseThresholds, registerAutoHandoff } from "./auto-handoff.ts";

function host(result = true) {
	const events = new Map<string, Function>();
	const commands = new Map<string, any>();
	const entries: any[] = [];
	const queued: string[] = [];
	const notices: string[] = [];
	let aborts = 0;
	let handoffs = 0;
	let renders = 0;
	let percent: number | null = 60;
	let pendingMessages = false;
	(globalThis as any).__piInputBox = { requestRender: () => renders++ };
	const ctx: any = {
		model: { provider: "openai-codex", id: "test" },
		sessionManager: { getBranch: () => entries },
		ui: { notify: (text: string) => notices.push(text) },
		getContextUsage: () => ({ percent }),
		hasPendingMessages: () => pendingMessages,
		isIdle: () => true,
		abort: () => aborts++,
	};
	const state = registerAutoHandoff({
		on: (name: string, fn: Function) => events.set(name, fn),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		sendUserMessage: async (text: string, options: any) => {
			assert.equal(options.expandPromptTemplates, true);
			queued.push(text);
		},
	} as any, async () => { handoffs++; return result; });
	const emit = (name: string, event: any = {}) => events.get(name)!(event, ctx);
	const command = (args: string) => commands.get("auto-handoff").handler(args, ctx);
	const turn = (event = {}) => emit("turn_end", { outcome: "completed", toolResults: [{}], continue: false, ...event });
	emit("session_start", { reason: "startup" });
	return { state, ctx, entries, queued, notices, emit, command, turn,
		get aborts() { return aborts; }, get handoffs() { return handoffs; }, get renders() { return renders; },
		set percent(value: number | null) { percent = value; },
		set pendingMessages(value: boolean) { pendingMessages = value; },
	};
}

test("thresholds select exact model before provider; invalid values fail closed", () => {
	const config = parseThresholds({ providers: { openai: 60, "openai-codex": 60, anthropic: 25 }, models: { "anthropic/small": 50 } });
	assert.equal(handoffThreshold(config, "openai", "test"), 60);
	assert.equal(handoffThreshold(config, "openai-codex", "test"), 60);
	assert.equal(handoffThreshold(config, "anthropic", "test"), 25);
	assert.equal(handoffThreshold(config, "anthropic", "small"), 50);
	assert.equal(handoffThreshold(config, "unknown", "test"), undefined);
	assert.equal(handoffThreshold(config, "toString", "test"), undefined);
	for (const invalid of [null, [], "60", -1, 0, 100, Infinity, NaN]) {
		assert.throws(() => parseThresholds({ providers: { test: invalid } }));
	}
	for (const invalid of [null, 1, { providers: [] }, { models: "bad" }]) assert.throws(() => parseThresholds(invalid));
});

test("names increase one suffix, support unnamed sessions and large counters", () => {
	assert.equal(nextHandoffName("작업명"), "작업명_1");
	assert.equal(nextHandoffName("작업명_1"), "작업명_2");
	assert.equal(nextHandoffName(" 작업_9 "), "작업_10");
	assert.equal(nextHandoffName(undefined), "이름 없음_1");
	assert.equal(nextHandoffName("a_9007199254740992"), "a_9007199254740993");
});

test("default off, explicit switches persist and immediately repaint, separate session off", async () => {
	const h = host();
	h.turn(); h.emit("agent_settled", { aborted: false });
	assert.equal(h.state.enabled, false);
	assert.equal(h.aborts, 0);
	assert.deepEqual(h.queued, []);
	await h.command("on");
	assert.equal(h.state.enabled, true);
	assert.equal((globalThis as any).__piAutoHandoff.enabled, true);
	assert.equal(h.renders, 2);
	h.emit("session_start", { reason: "reload" });
	assert.equal(h.state.enabled, true);
	await h.command("off");
	assert.equal((globalThis as any).__piAutoHandoff.enabled, false);
	await h.command("invalid");
	assert.match(h.notices.at(-1)!, /사용법/);
	h.entries.length = 0;
	h.emit("session_start", { reason: "new" });
	assert.equal(h.state.enabled, false);
	h.emit("session_shutdown");
	assert.equal((globalThis as any).__piAutoHandoff, undefined);
});

test("crossing the threshold stops only at turn_end, dispatches once after settling", async () => {
	const h = host();
	await h.command("on");
	h.percent = 59.99; h.turn();
	assert.equal(h.aborts, 0);
	h.percent = 60; h.turn(); h.turn();
	assert.equal(h.aborts, 1);
	assert.equal(h.handoffs, 0);
	assert.equal(h.queued.length, 0);
	assert.deepEqual(h.emit("session_before_compact", { reason: "threshold" }), { cancel: true });
	assert.equal(h.emit("session_before_compact", { reason: "manual" }), undefined);
	assert.equal(h.emit("session_before_compact", { reason: "overflow" }), undefined);
	h.emit("agent_settled", { aborted: true });
	assert.deepEqual(h.queued, ["/auto-handoff"]);
	await h.command("");
	assert.equal(h.handoffs, 1);
	await h.command("");
	assert.equal(h.handoffs, 1);
});

test("Anthropic uses 25%, a final answer switches without an abort", async () => {
	const h = host();
	await h.command("on");
	h.ctx.model.provider = "anthropic";
	h.percent = 24.99; h.turn();
	assert.equal(h.aborts, 0);
	h.percent = 25; h.turn({ toolResults: [] });
	h.emit("agent_settled", { aborted: false });
	assert.equal(h.aborts, 0);
	await h.command("");
	assert.equal(h.handoffs, 1);
});

test("errors, user cancellation, queued input, unknown usage/provider and busy summary do not hand off", async () => {
	const h = host();
	await h.command("on");
	h.turn({ outcome: "error" });
	h.turn({ outcome: "aborted" });
	h.ctx.signal = AbortSignal.abort(); h.turn(); h.ctx.signal = undefined;
	h.pendingMessages = true; h.turn(); h.pendingMessages = false;
	h.percent = null; h.turn(); h.percent = NaN; h.turn(); h.percent = 60;
	h.ctx.model.provider = "unknown"; h.turn(); h.ctx.model.provider = "openai-codex";
	h.state.busy = true; h.turn(); h.state.busy = false;
	h.emit("agent_settled", { aborted: true });
	assert.equal(h.aborts, 0);
	assert.equal(h.queued.length, 0);
	h.turn({ toolResults: [] });
	h.emit("agent_settled", { aborted: true });
	assert.equal(h.queued.length, 0);
});

test("off cancels pending handoff, failures disable it rather than retrying", async () => {
	const h = host(false);
	await h.command("on"); h.turn(); await h.command("off");
	h.emit("agent_settled", { aborted: true });
	assert.equal(h.queued.length, 0);
	await h.command("on"); h.turn(); h.emit("agent_settled", { aborted: true });
	await h.command("");
	assert.equal(h.state.enabled, false);
	assert.match(h.notices.at(-1)!, /반복 실패/);
	h.turn(); h.emit("agent_settled", { aborted: false });
	assert.equal(h.handoffs, 1);
});

test("inherited on survives resume/tree; a no-work resume does not create a relay loop", async () => {
	const h = host();
	await h.command("on");
	h.emit("session_start", { reason: "new" });
	h.turn({ toolResults: [] }); h.emit("agent_settled", { aborted: false });
	assert.equal(h.queued.length, 0);
	h.turn(); h.emit("agent_settled", { aborted: true });
	assert.equal(h.queued.length, 1);
	h.entries.length = 0;
	h.emit("session_tree");
	assert.equal(h.state.enabled, false);
});
