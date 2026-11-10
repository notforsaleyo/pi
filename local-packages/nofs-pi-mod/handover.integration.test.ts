import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import handoff from "./handoff.ts";

const packageDir = process.env.PI_TEST_PACKAGE;
const NOTE = "Original handoff context: preserve this exact text.";
const textOf = (m: any) => typeof m.content === "string" ? m.content : m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");

test("handover checks durable delivery with the installed SDK", { skip: !packageDir, timeout: 30_000 }, async (t) => {
	const sdk = await import(pathToFileURL(join(packageDir!, "dist/index.js")).href);
	const { createAssistantMessageEventStream } = await import(pathToFileURL(join(packageDir!, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")).href);
	for (const scenario of ["success", "fresh", "handled", "transformed", "no-auth", "provider-error", "memory", "replaced-note", "concurrent", "delayed"] as const) {
		await t.test(scenario, async (t) => {
			const cwd = await mkdtemp(join(tmpdir(), "pi-handover-test-"));
			let runtime: any;
			t.after(async () => { await runtime?.dispose(); await rm(cwd, { recursive: true, force: true }); });
			const file = join(cwd, ".pi/handoff.md");
			await mkdir(join(cwd, ".pi"));
			await writeFile(file, NOTE);
			const notices: string[] = [];
			const errors: unknown[] = [];
			let sent = 0;
			let started!: () => void;
			const requestStarted = new Promise<void>((resolve) => { started = resolve; });
			const modelDef = { id: "test", name: "Test", api: "openai-responses", baseUrl: "http://unused.invalid",
				reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4096 };
			const streamSimple = (model: any) => {
				sent++;
				started();
				if (scenario === "replaced-note") writeFileSync(file, "A newer note");
				const stream = createAssistantMessageEventStream();
				const failed = scenario === "provider-error";
				const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
					content: [{ type: "text", text: "Received." }], stopReason: failed ? "error" : "stop", ...(failed ? { errorMessage: "test failure" } : {}),
					usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
				queueMicrotask(() => {
					stream.push({ type: "start", partial: message });
					stream.push(failed ? { type: "error", reason: "error", error: message } : { type: "done", reason: "stop", message });
				});
				return stream;
			};
			const manager = scenario === "memory" ? sdk.SessionManager.inMemory(cwd) : sdk.SessionManager.create(cwd, join(cwd, "sessions"));
			// An old copy must not be mistaken for a newly delivered message.
			if (scenario === "fresh") assert.equal(existsSync(manager.getSessionFile()), false);
			else manager.appendMessage({ role: "user", content: NOTE, timestamp: Date.now() });
			const priorIds = new Set(manager.getBranch().map((e: any) => e.id));
			runtime = await sdk.createAgentSessionRuntime(async ({ sessionManager, sessionStartEvent }: any) => {
				const settingsManager = sdk.SettingsManager.inMemory({ packages: [], retry: { enabled: false }, cacheWarming: "off" });
				const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, refreshOnCreate: false });
				const services = await sdk.createAgentSessionServices({ cwd, agentDir: cwd, settingsManager, modelRuntime,
					resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
						extensionFactories: [handoff, (pi: any) => {
							pi.registerProvider("handover-test", { api: "openai-responses", baseUrl: "http://unused.invalid", models: [modelDef], streamSimple,
								...(scenario === "no-auth" ? {} : { apiKey: "fake-test-key" }) });
							pi.on("input", async (event: any) => {
								if (event.source !== "extension") return;
								if (scenario === "delayed") await new Promise((resolve) => setTimeout(resolve, 2000));
								if (scenario === "handled") return { action: "handled" };
								if (scenario === "transformed") return { action: "transform", text: "Different text" };
							});
						}] },
				});
				const result = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model: { ...modelDef, provider: "handover-test" }, tools: [] });
				assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
				return { ...result, services, diagnostics: services.diagnostics };
			}, { cwd, agentDir: cwd, sessionManager: manager });
			await runtime.session.bindExtensions({ mode: "tui", uiContext: { notify: (text: string) => notices.push(text), setWidget() {} }, onError: (e: unknown) => errors.push(e) });
			if (scenario === "concurrent") await Promise.all([runtime.session.prompt("/handover"), runtime.session.prompt("/handover")]);
			else await runtime.session.prompt("/handover");
			if (scenario === "delayed") {
				assert(existsSync(file), "timeout must preserve the note");
				await requestStarted;
			}
			await runtime.session.waitForIdle();
			const delivered = manager.getBranch().filter((e: any) => !priorIds.has(e.id) && e.type === "message" && e.message.role === "user" && textOf(e.message) === NOTE);
			const keepsFile = ["handled", "transformed", "no-auth", "memory", "replaced-note", "delayed"].includes(scenario);
			assert.equal(existsSync(file), keepsFile, notices.join("\n"));
			if (keepsFile) assert.equal(await readFile(file, "utf8"), scenario === "replaced-note" ? "A newer note" : NOTE);
			else {
				assert.equal(delivered.length, 1);
				const entries = (await readFile(manager.getSessionFile(), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
				assert(entries.some((e: any) => e.id === delivered[0].id), "file deletion must follow persistence");
			}
			assert.equal(sent, ["handled", "no-auth"].includes(scenario) ? 0 : 1);
			if (scenario !== "no-auth") assert.deepEqual(errors, []);
		});
	}
});

test("handover rejects busy and queued sessions before reading or sending", async () => {
	let handler: any;
	handoff({ on() {}, registerTool() {}, registerCommand: (name: string, command: any) => {
		if (name === "handover") handler = command.handler;
	}, sendUserMessage() { assert.fail("must not send"); } } as any);
	for (const [idle, pending] of [[false, false], [true, true]]) {
		let warned = false;
		await handler("", { isIdle: () => idle, hasPendingMessages: () => pending, ui: { notify: () => { warned = true; } } });
		assert(warned);
	}
});

test("handover preserves the note if its session changes or is disposed during delivery", async (t) => {
	for (const stop of ["switch", "dispose"] as const) {
		const cwd = await mkdtemp(join(tmpdir(), "pi-handover-stop-"));
		t.after(() => rm(cwd, { recursive: true, force: true }));
		await mkdir(join(cwd, ".pi"));
		const file = join(cwd, ".pi/handoff.md");
		await writeFile(file, NOTE);
		const events = new Map<string, Function[]>();
		let handler: any;
		let sessionId = "original";
		let disposed = false;
		const entries: any[] = [];
		handoff({
			on(name: string, fn: Function) { events.set(name, [...events.get(name) ?? [], fn]); },
			registerTool() {}, registerCommand(name: string, command: any) { if (name === "handover") handler = command.handler; },
			sendUserMessage() {
				entries.push({ id: "new", type: "message", message: { role: "user", content: NOTE } });
				if (stop === "switch") sessionId = "replacement";
				else {
					disposed = true;
					for (const fn of events.get("session_shutdown") ?? []) fn();
				}
			},
		} as any);
		await handler("", {
			cwd, isIdle: () => true, hasPendingMessages: () => false,
			ui: { notify() { assert(!disposed, "must not use a disposed UI"); } },
			sessionManager: {
				getSessionId() { assert(!disposed); return sessionId; },
				getSessionFile: () => join(cwd, "session.jsonl"), getBranch: () => entries,
			},
		});
		assert.equal(await readFile(file, "utf8"), NOTE);
	}
});
