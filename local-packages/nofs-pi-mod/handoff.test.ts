import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import handoff, { parseHandoffArgs } from "./handoff.ts";

test("handoff separates the trimmed name, options, and opaque task", () => {
	const cases = [
		["  다음  세션 이름  ", "다음  세션 이름", false, false, ""],
		["이름 --purge", "이름", true, false, ""],
		["이름 --force", "이름", false, true, ""],
		["이름 --purge --force -- 테스트부터 확인", "이름", true, true, "테스트부터 확인"],
		["이름\t--force\t--purge\t", "이름", true, true, ""],
		["이름 --", "이름", false, false, ""],
		["이름 -- --purge --force --unknown -- 다음\n줄", "이름", false, false, "--purge --force --unknown -- 다음\n줄"],
		["이름--force -- 작업  내부 공백", "이름", false, true, "작업  내부 공백"],
	] as const;
	for (const [input, name, purge, force, task] of cases) {
		assert.deepEqual(parseHandoffArgs(input), { name, purge, force, task }, input);
	}
});

test("handoff rejects missing names and malformed options before doing any work", async () => {
	let handler: any;
	handoff({ on() {}, registerCommand: (name: string, command: any) => {
		if (name === "handoff") handler = command.handler;
	} } as any);
	for (const input of ["", "  ", "--purge", "-- 작업", "이름 --unknown", "이름 --forceful", "이름 --purge 작업"]) {
		assert.equal(parseHandoffArgs(input), null, input);
		const notices: string[] = [];
		await handler(input, { ui: { notify: (message: string) => notices.push(message) } });
		assert.equal(notices.length, 1);
		assert.match(notices[0]!, /사용법:/);
	}
});

test("handoff names the replacement session and keeps focus separate from the task", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-handoff-test-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	let handler: any;
	const branch: any[] = [];
	let request = "";
	let sessionName = "";
	let editorText = "";
	let focusPrompts = 0;
	const inherited: Record<string, unknown> = {};
	branch.push({ type: "custom", customType: "agent-mode", data: { mode: "spec" } });
	handoff({
		on() {},
		registerCommand: (name: string, command: any) => {
			if (name === "handoff") handler = command.handler;
		},
		sendUserMessage: (text: string) => {
			request = text;
			branch.push(
				{ type: "message", message: { role: "user", content: text } },
				{ type: "message", message: { role: "assistant", content: "Handoff context", stopReason: "stop" } },
			);
		},
	} as any);
	await handler("  다음  세션  -- 작업\n--purge --force -- 그대로 전달", {
		cwd, model: { provider: "anthropic", id: "test" }, thinkingLevel: "high", hasUI: true,
		ui: {
			notify() {},
			select: async () => { focusPrompts++; return "직접 작성"; },
			editor: async () => "요약 중점",
		},
		isIdle: () => true,
		waitForIdle: async () => {},
		sessionManager: { getSessionFile: () => undefined, getBranch: () => branch, getEntries: () => branch },
		newSession: async ({ setup, withSession }: any) => {
			await setup({
				appendSessionInfo: (name: string) => { sessionName = name; },
				appendCustomEntry: (key: string, value: unknown) => { inherited[key] = value; },
			});
			await withSession({ ui: { notify() {}, setEditorText: (text: string) => { editorText = text; } } });
			return { cancelled: false };
		},
	});
	assert.equal(sessionName, "다음  세션");
	assert.equal(editorText, "/handover");
	assert.deepEqual(inherited["agent-mode"], { mode: "spec" });
	assert.deepEqual(inherited["auto-handoff"], { enabled: false });
	assert.deepEqual(inherited["handoff-model"], { provider: "anthropic", id: "test", thinkingLevel: "high" });
	assert.equal(focusPrompts, 1);
	assert.match(request, /Focus for this note:\n요약 중점/);
	assert.match(request, /Task for the next agent:\n작업\n--purge --force -- 그대로 전달$/);
	assert.equal(await readFile(join(cwd, ".pi", "handoff.md"), "utf8"),
		"Handoff context\n\n---\n\n## Task\n작업\n--purge --force -- 그대로 전달");
});
