import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const AUTO_HANDOFF_ENTRY = "auto-handoff";
const NUDGE_ENTRY = "auto-handoff-nudge";
const NUDGE = "Context usage has reached the automatic handoff threshold. Do not start a new unit of work or try to finish the entire remaining request. Bring only the work currently in progress to a nearby safe stopping point, including any necessary checks. Respect the current mode and pending approvals. When ready, call request_handoff by itself; the harness will then ask you to write the handoff note and pass it to the next session. If already finished or blocked, request handoff without doing additional work.";
export const AUTO_HANDOFF_TASK = "Continue only the unfinished work already requested by the user, from the recorded stopping point. Do not repeat completed work or expand the scope. Respect pending approvals and unanswered questions; if blocked or everything is complete, stop and wait for the user.";

type Thresholds = { providers: Record<string, number>; models: Record<string, number> };

export function parseThresholds(value: unknown): Thresholds {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("설정은 객체여야 합니다.");
	const result: Thresholds = { providers: {}, models: {} };
	for (const key of ["providers", "models"] as const) {
		const entries = (value as Record<string, unknown>)[key] ?? {};
		if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error(`${key} 는 객체여야 합니다.`);
		for (const [name, percent] of Object.entries(entries)) {
			if (typeof percent !== "number" || !Number.isFinite(percent) || percent <= 0 || percent >= 100) {
				throw new Error(`${key}.${name}: 사용률은 0보다 크고 100보다 작은 숫자여야 합니다.`);
			}
			Object.defineProperty(result[key], name, { value: percent, enumerable: true });
		}
	}
	return result;
}

export function handoffThreshold(config: Thresholds, provider: string, model: string): number | undefined {
	const key = `${provider}/${model}`;
	return Object.hasOwn(config.models, key) ? config.models[key]
		: Object.hasOwn(config.providers, provider) ? config.providers[provider] : undefined;
}

export function nextHandoffName(name: string | undefined): string {
	const current = name?.trim() || "이름 없음";
	const match = /^(.*)_(\d+)$/.exec(current);
	return match ? `${match[1]}_${BigInt(match[2]!) + 1n}` : `${current}_1`;
}

// 등록은 handoff.ts 에서만 한다. 별도 extension entry point가 아니다.
export function registerAutoHandoff(pi: ExtensionAPI, handoff: (ctx: ExtensionCommandContext) => Promise<boolean>) {
	const state = { enabled: false, busy: false, disposed: false };
	const g = globalThis as any;
	let pending = false;
	let nudged = false;
	let interrupted = false;
	let runningAuto = false;
	let firstResumeTurn = false;
	let config: Thresholds | undefined;
	let configError = "";
	try {
		config = parseThresholds(JSON.parse(readFileSync(new URL("./auto-handoff.json", import.meta.url), "utf8")));
	} catch (error) {
		configError = `auto-handoff.json: ${(error as Error).message}`;
	}
	const render = () => {
		g.__piAutoHandoff = { enabled: state.enabled };
		g.__piInputBox?.requestRender?.();
	};
	const setEnabled = (enabled: boolean) => {
		pi.appendEntry(AUTO_HANDOFF_ENTRY, { enabled });
		if (!enabled || !state.enabled) nudged = false;
		state.enabled = enabled;
		if (!enabled) pending = false;
		render();
	};
	const restore = (ctx: ExtensionContext) => {
		state.enabled = false;
		nudged = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === AUTO_HANDOFF_ENTRY &&
				typeof (entry.data as any)?.enabled === "boolean") {
				const enabled = (entry.data as any).enabled;
				if (!enabled || !state.enabled) nudged = false;
				state.enabled = enabled;
			}
			if (entry.type === "custom_message" && entry.customType === NUDGE_ENTRY && state.enabled) nudged = true;
		}
		if (!config) state.enabled = false;
		pending = false;
		interrupted = false;
		render();
	};
	pi.on("session_start", (event, ctx) => {
		restore(ctx);
		firstResumeTurn = event.reason === "new" && state.enabled;
		if (configError) ctx.ui.notify(configError, "warning");
	});
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_shutdown", () => {
		state.disposed = true;
		pending = false;
		delete g.__piAutoHandoff;
		g.__piInputBox?.requestRender?.();
	});

	pi.registerCommand("auto-handoff", {
		description: "Automatic context handoff: /auto-handoff [on|off] (default: off)",
		getArgumentCompletions: (prefix) => ["on", "off"].filter((s) => s.startsWith(prefix)).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			// agent_settled 에서 예약한 무인자 호출만 자동 전환을 실행한다.
			if (!value && pending && state.enabled && !state.busy && ctx.isIdle()) {
				pending = false;
				if (ctx.hasPendingMessages()) return;
				state.busy = runningAuto = true;
				let switched = false;
				try {
					switched = await handoff(ctx);
				} catch (error) {
					if (state.disposed) throw error;
					ctx.ui.notify(`자동 핸드오프 실패: ${(error as Error).message}`, "error");
				} finally {
					state.busy = runningAuto = false;
					if (!switched && !state.disposed && state.enabled) {
						setEnabled(false);
						ctx.ui.notify("반복 실패를 막기 위해 자동 핸드오프를 껐습니다. 확인 후 /auto-handoff on 으로 다시 켜십시오.", "warning");
					}
				}
				return;
			}
			if (value !== "on" && value !== "off") {
				ctx.ui.notify("사용법: /auto-handoff [on|off]", "info");
				return;
			}
			if (value === "on" && !config) {
				ctx.ui.notify(configError, "error");
				return;
			}
			setEnabled(value === "on");
		},
	});

	pi.registerTool({
		name: "request_handoff",
		label: "Request Handoff",
		description: "After an automatic handoff nudge, call this tool by itself once the current work is at a safe stopping point. The harness will request a handoff note and continue in a new session. This does not authorize additional work or bypass pending approvals.",
		exposure: "model-only",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute(_id, _params, signal, _onUpdate, ctx) {
			if (!state.enabled || !nudged || state.busy || state.disposed || signal?.aborted || ctx.hasPendingMessages()) {
				return { content: [{ type: "text", text: "Handoff is not available: it must be enabled and nudged, with no cancellation, queued input, or handoff already in progress. Follow the user's current instructions." }], details: {}, isError: true };
			}
			pending = true;
			return { content: [{ type: "text", text: "Handoff requested. After this tool batch finishes, the harness will ask you to write the note." }], details: {}, terminate: true };
		},
	});

	pi.on("turn_end", (event, ctx) => {
		// 요청 후 abort가 만든 종료 턴은 예약된 전환을 취소하지 않는다.
		if (!state.enabled || state.busy || interrupted) return;
		if (event.outcome !== "completed" || ctx.signal?.aborted || ctx.hasPendingMessages()) {
			pending = false;
			return;
		}
		if (pending) {
			// 모델이 요청한 뒤에만 멈춘다. 같은 턴의 병렬 도구 결과도 모두 저장된 시점이다.
			interrupted = true;
			ctx.abort();
			return;
		}
		// 계승 직후 작업 없이 종료한 응답을 또 넘겨 빈 핸드오프가 반복되는 것을 막는다.
		const onlyResumed = firstResumeTurn && event.toolResults.length === 0;
		firstResumeTurn = false;
		if (onlyResumed || nudged || !ctx.model || !config) return;
		const threshold = handoffThreshold(config, ctx.model.provider, ctx.model.id);
		const percent = ctx.getContextUsage()?.percent;
		if (threshold === undefined || percent == null || !Number.isFinite(percent) || percent < threshold) return;
		nudged = true;
		return {
			entries: [...event.entries, { type: "custom_message", customType: NUDGE_ENTRY, content: NUDGE, display: true }],
			continue: true,
		};
	});
	pi.on("agent_settled", (event, ctx) => {
		if (event.aborted && !interrupted) pending = false;
		interrupted = false;
		if (!pending || !state.enabled || state.busy) return;
		if (ctx.hasPendingMessages()) { pending = false; return; }
		// 여기서 await 하면 settled 디스패치와 교착한다. 명령은 모든 핸들러 종료 후 실행된다.
		pi.sendUserMessage("/auto-handoff", { expandPromptTemplates: true });
	});
	pi.on("session_before_compact", (event) => {
		// 수동 압축과 overflow 복구는 유지하고, 전환/요약과 경쟁하는 threshold 압축만 피한다.
		if (event.reason === "threshold" && (pending || runningAuto)) return { cancel: true };
	});
	return Object.assign(state, { setEnabled });
}
