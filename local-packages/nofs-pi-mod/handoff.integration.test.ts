import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

// Installed Pi SDK, isolated temp sessions/settings, fake providers only; no network or user-session access.
const packageDir = process.env.PI_TEST_PACKAGE;
const textOf = (message: any) => typeof message?.content === "string" ? message.content
	: (message?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");

test("real Pi runtime: default off, safe mid-task handoff, mode/model inheritance and failure recovery", {
	skip: !packageDir, timeout: 60_000,
}, async (t) => {
	const sdk = await import(pathToFileURL(join(packageDir!, "dist/index.js")).href);
	const { createAssistantMessageEventStream } = await import(pathToFileURL(join(packageDir!, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")).href);
	for (const scenario of ["off", "plan", "spec", "bash", "note-error", "cancel-switch", "existing-note", "new-input", "off-during-note"] as const) {
		await t.test(scenario, { timeout: 8000 }, async (t) => {
			const cwd = await mkdtemp(join(tmpdir(), "pi-auto-handoff-integration-"));
			let runtime: any;
			t.after(async () => { await runtime?.dispose(); await rm(cwd, { recursive: true, force: true }); });
			const mode = ["plan", "spec", "bash"].includes(scenario) ? scenario : "bash";
			const errors: unknown[] = [];
			const notices: string[] = [];
			const requests: any[] = [];
			let finishedTools = 0;
			let draft = "unsent draft";
			let generation = 0;
			const modelDef = { id: "handoff-test", name: "Handoff Test", api: "openai-responses", baseUrl: "http://unused.invalid",
				reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 100_000, maxTokens: 4096 };
			const originalModel = { ...modelDef, provider: "openai-codex" };
			const fallbackModel = { ...modelDef, provider: "anthropic" };
			const fakeStream = (model: any, context: any, options: any) => {
				const stream = createAssistantMessageEventStream();
				const lastUser = context.messages.findLast((m: any) => m.role === "user");
				const prompt = textOf(lastUser);
				const summary = prompt.startsWith("You are writing a handoff note");
				const resume = prompt.startsWith("Continue only the unfinished work");
				const interrupted = !!options?.signal?.aborted;
				if (!interrupted) requests.push({ model, prompt, messages: context.messages });
				const first = !summary && !resume && !context.messages.some((m: any) => m.role === "toolResult");
				const fail = summary && scenario === "note-error";
				if (summary) {
					assert(prompt.includes("Focus for this note:\nFocus on the current task and the conversation since that task began. Exclude earlier discussions unrelated to the current task. Retain earlier context only when it directly affects the current task's requirements, decisions, constraints, or pending approvals. Do not treat unrelated earlier requests as unfinished work to resume."));
					assert(finishedTools >= 2 && finishedTools % 2 === 0, "both sibling tools must finish before summary");
					if (scenario === "new-input") void runtime.session.prompt("New user request", { streamingBehavior: "followUp" });
					if (scenario === "off-during-note") void runtime.session.prompt("/auto-handoff off");
				}
				if (resume) {
					assert.equal(model.provider, "openai-codex");
					assert.match(prompt, new RegExp(`Current mode: ${mode.toUpperCase()}`));
					assert(context.messages.some((m: any) => textOf(m) === "Saved context: both probes completed; finish the requested work."));
				}
				const message = {
					role: "assistant", api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
					content: interrupted || fail ? [] : first
						? [1, 2].map((n) => ({ type: "toolCall", id: `probe-${generation}-${n}`, name: "probe", arguments: { n } }))
						: [{ type: "text", text: summary ? "Saved context: both probes completed; finish the requested work." : "Completed." }],
					usage: { input: 65_000, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 65_020,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: interrupted ? "aborted" : fail ? "error" : first ? "toolUse" : "stop",
					...(fail ? { errorMessage: "test note failure" } : {}),
				};
				queueMicrotask(() => {
					stream.push({ type: "start", partial: message });
					if (interrupted || fail) stream.push({ type: "error", reason: message.stopReason, error: message });
					else stream.push({ type: "done", reason: message.stopReason, message });
				});
				return stream;
			};
			const createRuntime = async ({ sessionManager, sessionStartEvent }: any) => {
				generation++;
				const settingsManager = sdk.SettingsManager.inMemory({
					packages: [], compaction: { enabled: true }, retry: { enabled: false }, cacheWarming: "off",
				});
				const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: null, refreshOnCreate: false });
				const services = await sdk.createAgentSessionServices({
					cwd, agentDir: cwd, settingsManager, modelRuntime,
					resourceLoaderOptions: {
						noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
						additionalExtensionPaths: [
							fileURLToPath(new URL("../nofs-agent-modes/index.ts", import.meta.url)),
							fileURLToPath(new URL("./handoff.ts", import.meta.url)),
						],
						extensionFactories: [
							(pi: any) => {
								for (const provider of ["openai-codex", "anthropic"]) pi.registerProvider(provider, {
									api: "openai-responses", apiKey: "fake-test-key", baseUrl: "http://unused.invalid",
									models: [modelDef], streamSimple: fakeStream,
								});
								pi.registerTool({ name: "probe", label: "Probe", description: "Test only",
									parameters: { type: "object", properties: { n: { type: "number" } }, required: ["n"] },
									async execute(_id: string, { n }: any, signal: AbortSignal) {
										await new Promise((resolve) => setTimeout(resolve, n === 1 ? 10 : 1));
										assert.equal(signal.aborted, false, "running tools must not be cancelled");
										finishedTools++;
										return { content: [{ type: "text", text: `probe ${n} complete` }], details: {} };
									},
								});
								if (scenario === "cancel-switch") pi.on("session_before_switch", () => ({ cancel: true }));
							},
						],
					},
				});
				const result = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent,
					model: generation === 1 ? originalModel : fallbackModel, thinkingLevel: generation === 1 ? "high" : "low", tools: ["probe"],
				});
				assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
				return { ...result, services, diagnostics: services.diagnostics };
			};
			const manager = sdk.SessionManager.create(cwd, join(cwd, "sessions"));
			manager.appendSessionInfo("작업명");
			manager.appendCustomEntry("agent-mode", { mode });
			runtime = await sdk.createAgentSessionRuntime(createRuntime, { cwd, agentDir: cwd, sessionManager: manager });
			const bind = async () => {
				const session = runtime.session;
				await session.bindExtensions({
					mode: "tui",
					uiContext: { notify: (s: string) => notices.push(s), setWidget() {},
						getEditorText: () => draft, setEditorText: (s: string) => { draft = s; },
						select: () => { throw new Error("automatic handoff must not show a dialog"); },
					},
					onError: (e: unknown) => errors.push(e),
					commandContextActions: {
						waitForIdle: () => session.waitForIdle(),
						newSession: (options: any) => runtime.newSession(options),
					},
				});
			};
			runtime.setRebindSession(bind);
			await bind();
			const original = runtime.session;
			const originalFile = original.sessionFile;
			if (scenario === "existing-note") {
				await mkdir(join(cwd, ".pi"), { recursive: true });
				await writeFile(join(cwd, ".pi/handoff.md"), "Unconsumed note");
			}
			if (scenario !== "off") await original.prompt("/auto-handoff on");
			await original.prompt("Run both probes and finish the work.");
			assert.deepEqual(errors, [], JSON.stringify(errors));
			assert(existsSync(originalFile), "original session must survive");
			assert.equal(finishedTools, 2);
			if (scenario === "off") {
				assert.equal(runtime.session, original);
				assert.equal(requests.length, 2);
				assert.equal((globalThis as any).__piAutoHandoff.enabled, false);
			} else if (["note-error", "cancel-switch", "existing-note", "new-input", "off-during-note"].includes(scenario)) {
				assert.equal(runtime.session, original);
				assert.equal((globalThis as any).__piAutoHandoff.enabled, false);
				if (scenario !== "off-during-note") assert(notices.some((s) => s.includes("반복 실패")), notices.join("\n"));
				assert.equal(existsSync(join(cwd, ".pi/handoff.md")), scenario === "cancel-switch" || scenario === "existing-note");
				if (scenario === "existing-note") assert.equal(await readFile(join(cwd, ".pi/handoff.md"), "utf8"), "Unconsumed note");
				if (scenario === "new-input") assert(requests.some((r) => r.prompt.startsWith("New user request")));
			} else {
				assert.notEqual(runtime.session, original, notices.join("\n"));
				assert.equal(runtime.session.sessionManager.getSessionName(), "작업명_1");
				assert.equal(runtime.session.sessionManager.getHeader().parentSession, originalFile);
				assert.equal(runtime.session.model.provider, "openai-codex");
				assert.equal(runtime.session.thinkingLevel, "high");
				assert.equal((globalThis as any).__piAgentMode.id, mode);
				assert.equal((globalThis as any).__piAutoHandoff.enabled, true);
				assert.equal(draft, "unsent draft");
				assert.equal(requests.length, 3, "work, summary, continuation; no recursive summary");
				assert.equal(existsSync(join(cwd, ".pi/handoff.md")), false);
				assert.match(await readFile(runtime.session.sessionFile, "utf8"), /Saved context/);
				if (scenario === "bash") {
					const firstFile = runtime.session.sessionFile;
					await runtime.session.prompt("Run both probes again for the next work item.");
					assert.equal(runtime.session.sessionManager.getSessionName(), "작업명_2");
					assert.equal(runtime.session.sessionManager.getHeader().parentSession, firstFile);
					assert.equal((globalThis as any).__piAgentMode.id, "bash");
					assert.equal(requests.length, 6);
					assert.deepEqual(errors, []);
					await runtime.newSession();
					assert.equal((globalThis as any).__piAutoHandoff.enabled, false);
					assert.equal((globalThis as any).__piAgentMode.id, "plan");
				}
			}
		});
	}
});
