import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import handoff from "./handoff.ts";

const packageDir = process.env.PI_TEST_PACKAGE;
const NOTE = "Deferred handoff context\n\n## Task\nContinue tomorrow.";
const textOf = (m: any) => typeof m.content === "string" ? m.content : m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");

test("deferred handover persists and resumes without a model call", { skip: !packageDir, timeout: 30_000 }, async (t) => {
	const sdk = await import(pathToFileURL(join(packageDir!, "dist/index.js")).href);
	const { createAssistantMessageEventStream } = await import(pathToFileURL(join(packageDir!, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")).href);
	for (const scenario of ["fresh", "existing", "no-auth", "memory", "write-failure", "note-write-failure", "not-saved", "shutdown-state", "rpc-draft", "continue-without-resume", "replaced-note", "concurrent"] as const) {
		await t.test(scenario, async (t) => {
			const cwd = await mkdtemp(join(tmpdir(), "pi-handover-defer-"));
			let runtime: any;
			t.after(async () => { await runtime?.dispose(); await rm(cwd, { recursive: true, force: true }); });
			const file = join(cwd, ".pi/handoff.md");
			await mkdir(join(cwd, ".pi"));
			await writeFile(file, NOTE);
			const notices: string[] = [];
			const errors: unknown[] = [];
			let sent = 0;
			let agentStarts = 0;
			let shutdowns = 0;
			let editorReads = 0;
			let editorWrites = 0;
			let draft = "unsent draft";
			const visibleNotes: string[] = [];
			const modelDef = { id: "test", name: "Test", api: "openai-responses", baseUrl: "http://unused.invalid",
				reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 4096 };
			const createRuntime = async ({ sessionManager, sessionStartEvent }: any) => {
				const settingsManager = sdk.SettingsManager.inMemory({ packages: [], retry: { enabled: false }, cacheWarming: "off" });
				const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, refreshOnCreate: false });
				const services = await sdk.createAgentSessionServices({ cwd, agentDir: cwd, settingsManager, modelRuntime,
					resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
						extensionFactories: [handoff, (pi: any) => {
							pi.registerProvider("defer-test", { api: "openai-responses", baseUrl: "http://unused.invalid", models: [modelDef],
								...(scenario === "no-auth" ? {} : { apiKey: "fake-test-key" }),
								streamSimple: (model: any, context: any) => {
									sent++;
									assert.equal(context.messages.filter((m: any) => m.role === "user" && textOf(m) === NOTE).length, 1);
									const stream = createAssistantMessageEventStream();
									const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
										content: [{ type: "text", text: "Resumed." }], stopReason: "stop",
										usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
									queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message }); });
									return stream;
								},
							});
							pi.on("agent_start", () => { agentStarts++; });
							pi.on("input", (event: any) => { assert.notEqual(event.source, "extension", "defer must bypass prompt dispatch"); });
							pi.on("session_before_switch", () => { assert.fail("defer must not replace the runtime"); });
							pi.on("session_shutdown", () => {
								shutdowns++;
								if (scenario === "shutdown-state") pi.appendEntry("shutdown-probe", { saved: true });
							});
						}] },
				});
				const result = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
					model: { ...modelDef, provider: "defer-test" }, thinkingLevel: "high", tools: [] });
				assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
				return { ...result, services, diagnostics: services.diagnostics };
			};
			const manager = scenario === "memory" ? sdk.SessionManager.inMemory(cwd) : sdk.SessionManager.create(cwd, join(cwd, "sessions"));
			manager.appendSessionInfo("내일 이어 할 작업");
			manager.appendCustomEntry("agent-mode", { mode: "spec" });
			if (scenario === "existing" || scenario === "not-saved") manager.appendMessage({ role: "user", content: "Earlier context", timestamp: Date.now() });
			const sessionId = manager.getSessionId();
			const sessionFile = manager.getSessionFile();
			runtime = await sdk.createAgentSessionRuntime(createRuntime, { cwd, agentDir: cwd, sessionManager: manager });
			const bind = async () => {
				const session = runtime.session;
				session.subscribe((event: any) => {
					if (event.type !== "message_end" || event.message.role !== "custom" || !event.message.display) return;
					visibleNotes.push(textOf(event.message));
					if (scenario === "replaced-note") writeFileSync(file, "A newer note");
				});
				await session.bindExtensions({ mode: scenario === "rpc-draft" ? "rpc" : "tui",
					uiContext: { notify: (s: string) => notices.push(s), setWidget() {},
						getEditorText: () => { editorReads++; return scenario === "rpc-draft" ? "" : draft; },
						setEditorText: (s: string) => { editorWrites++; draft = s; },
					},
					onError: (e: unknown) => errors.push(e),
					commandContextActions: { waitForIdle: () => session.waitForIdle(), switchSession: (path: string, options: any) => runtime.switchSession(path, options) },
				});
			};
			runtime.setRebindSession(bind);
			await bind();
			if (scenario === "fresh") assert.equal(existsSync(sessionFile), false, "named empty sessions are not saved yet");
			if (scenario === "write-failure") await mkdir(sessionFile);
			if (scenario === "note-write-failure") manager.appendCustomMessageEntry = () => { throw new Error("test note write failure"); };
			if (scenario === "not-saved") manager.appendCustomMessageEntry = () => "not-written";
			const original = runtime.session;
			if (scenario === "concurrent") await Promise.all([runtime.session.prompt("/handover --defer"), runtime.session.prompt("/handover --defer")]);
			else await runtime.session.prompt("/handover --defer");
			await runtime.session.waitForIdle();
			assert.equal(sent, 0, notices.join("\n"));
			assert.equal(agentStarts, 0);
			assert.equal(runtime.session, original, "defer must keep the live runtime and its extension state");
			assert.equal(shutdowns, 0, "saving a note must not run shutdown hooks");
			assert.equal(editorReads, 0);
			assert.equal(editorWrites, 0);
			assert.equal(draft, "unsent draft");
			if (scenario === "note-write-failure") assert(errors.some((e: any) => String(e.error ?? e).includes("test note write failure")), JSON.stringify(errors));
			else assert.deepEqual(errors, []);
			const keepsFile = ["memory", "write-failure", "note-write-failure", "not-saved", "replaced-note"].includes(scenario);
			assert.equal(existsSync(file), keepsFile, notices.join("\n"));
			if (keepsFile) assert.equal(await readFile(file, "utf8"), scenario === "replaced-note" ? "A newer note" : NOTE);
			if (["memory", "write-failure", "note-write-failure", "not-saved"].includes(scenario)) {
				assert(!manager.getBranch().some((e: any) => e.type === "custom_message" && e.content === NOTE));
				assert(notices.some((s) => s.includes(scenario === "memory" ? "비영속" : "실패")), notices.join("\n"));
				return;
			}
			assert.deepEqual(visibleNotes, [NOTE], "the UI receives the note through the normal visible message event");
			const liveNote = runtime.session.messages.find((m: any) => m.role === "custom" && textOf(m) === NOTE);
			assert(liveNote, "live context must include the note immediately");
			if (scenario === "fresh") {
				sdk.initTheme("dark", false);
				const rendered = new sdk.CustomMessageComponent(liveNote).render(80).join("\n");
				assert.match(rendered, /\[handover-note\]/);
				assert.match(rendered, /Deferred handoff context/);
				assert.match(rendered, /Continue tomorrow\./);
			}
			if (scenario === "continue-without-resume") {
				await runtime.session.prompt("Continue now.");
				assert.equal(sent, 1);
				assert.deepEqual(errors, []);
				return;
			}
			await runtime.dispose();
			const reopened = sdk.SessionManager.open(sessionFile);
			assert.equal(reopened.getSessionId(), sessionId);
			assert.equal(reopened.getSessionName(), "내일 이어 할 작업");
			assert.equal(reopened.getCwd(), cwd);
			const branch = reopened.getBranch();
			assert.equal(branch.filter((e: any) => e.type === "custom_message" && e.customType === "handover-note" && e.content === NOTE).length, 1);
			const request = branch.find((e: any) => e.type === "message" && e.message.role === "user" && textOf(e.message) === "/handover --defer");
			assert(request, "the command records the real user action and makes a fresh session persistent");
			assert.equal(branch.find((e: any) => e.type === "custom_message" && e.content === NOTE).details.requestId, request.id);
			if (scenario === "shutdown-state") assert.deepEqual(branch.find((e: any) => e.type === "custom" && e.customType === "shutdown-probe").data, { saved: true });
			assert(!branch.some((e: any) => e.type === "message" && e.message.role === "assistant"));
			assert.deepEqual(branch.find((e: any) => e.type === "custom" && e.customType === "agent-mode").data, { mode: "spec" });
			if (scenario === "existing") assert(branch.some((e: any) => e.type === "message" && textOf(e.message) === "Earlier context"));
			assert((await sdk.SessionManager.list(cwd, join(cwd, "sessions"))).some((s: any) => s.id === sessionId && s.name === "내일 이어 할 작업"));
			runtime = await sdk.createAgentSessionRuntime(createRuntime, { cwd, agentDir: cwd, sessionManager: reopened });
			runtime.setRebindSession(bind);
			await bind();
			assert.equal(runtime.session.model.provider, "defer-test");
			assert.equal(runtime.session.thinkingLevel, "high");
			assert.equal(sent, 0, "resuming must not call the model either");
			if (scenario === "shutdown-state") {
				runtime.session.sessionManager.appendCustomEntry("after-resume", {});
				assert(sdk.SessionManager.open(sessionFile).getBranch().some((e: any) => e.type === "custom" && e.customType === "shutdown-probe"), "later writes must not drop shutdown state from the active branch");
			}
			if (scenario !== "no-auth") {
				await runtime.session.prompt("Continue now.");
				assert.equal(sent, 1, "only an explicit prompt starts the model");
			}
			assert.deepEqual(errors, []);
		});
	}
});
