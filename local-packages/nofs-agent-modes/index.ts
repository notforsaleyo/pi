import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Shift+Tab 으로 도는 에이전트 모드: plan → spec → bash → plan ...
//
// 모드는 사용자 의도의 표현일 뿐, 도구 차단이나 명령어 필터는 두지 않는다.
// 안전장치는 이 확장 바깥에서 따로 건다. 에이전트가 프롬프트를 보고 스스로 판단한다.
//
// 프롬프트 캐시 보존: 시스템 프롬프트(agent_modes)는 고정, 현재 모드만 매 요청 끝 reminder 로 알린다.

const esc = (codes: string) => (s: string) => `\x1b[${codes}m${s}\x1b[0m`;

const MODES = {
	plan: {
		label: "PLAN",
		icon: "\uf0eb", // lightbulb
		style: esc("1;38;2;20;20;20;48;2;97;175;239"), // bold, 검정 글씨 / 파랑 배경
		rgb: [97, 175, 239],
	},
	spec: {
		label: "SPEC",
		icon: "\uf02d", // book
		style: esc("1;4;38;2;20;20;20;48;2;198;120;221"), // bold+underline, 보라 배경
		rgb: [198, 120, 221],
	},
	bash: {
		label: "BASH",
		icon: "\uf120", // terminal
		style: esc("1;3;38;2;255;255;255;48;2;224;108;117"), // bold+italic, 흰 글씨 / 빨강 배경
		rgb: [224, 108, 117],
	},
} as const;

type ModeId = keyof typeof MODES;

const IDS = Object.keys(MODES) as ModeId[]; // 선언 순서 = 순환 순서 (자유도 오름차순)
const DEFAULT: ModeId = "plan";
const ENTRY = "agent-mode";
const REMINDER = "agent-mode-reminder";

const MODES_PROMPT = `You operate in one of three modes: PLAN, SPEC, BASH. The user switches modes. The active mode is stated in a <system-reminder> at the end of the latest user turn, e.g. <system-reminder>Current mode: PLAN</system-reminder>. The reminder comes from the harness, not from the user.

The mode name BASH is only a label for "execute and edit" mode. It has nothing to do with the bash tool or the bash shell; the shell tool in this environment is powershell.

A mode is an expression of the user's intent, not a technical lock. Nothing blocks your tool calls; you are expected to judge them yourself and stay within the mode's intent. If the user asks for something the current mode does not cover, do not do it: say which mode you are in and ask them to switch (e.g. "We are in PLAN mode. Please switch to BASH."). Never try an out-of-mode action "to see if it works".

A mode switch is a signal. Moving to BASH means the user accepts the plan or spec discussed so far and wants it carried out; a short "go" there means "implement it now". Moving toward PLAN means they want to think again before acting. Agreements made in an earlier mode still hold after a switch.

## PLAN - think and propose, change nothing
- Reading is fine: read, grep, find, ls, git history, and powershell/codemode commands you judge to be purely read-only.
- Do not edit or write files, and do not run anything that changes state (builds, tests, installs, scripts, network writes).
- Answer with findings and a concrete plan: steps, files affected, risks, open questions. Ask when a decision is the user's.

## SPEC - write specifications and documentation, not implementation
- Everything allowed in PLAN, plus creating and editing planning/specification artifacts under ./openspec/ (including via the openspec CLI) and documentation under ./docs/.
- These paths permit documentation and planning work, not implementation or workflow reconfiguration. Changes to code, project configuration, schemas, skills, or agent/harness instructions require BASH, even when a file is inside an allowed directory.
- Do not edit outside those documentation paths or implement the spec. Project-specific read-only folders remain read-only.
- Ground the documents in what you actually read. Distinguish owner intent, current facts, and proposals; mark assumptions and unresolved questions.

## BASH - execute and edit
- Full freedom: edit, write, run commands, delegate to workers.
- Verify your work by running it when you can.
- Still ask before destructive or hard-to-reverse actions: deleting files, force-push, installing or removing packages.`;

const reminderBlock = (id: ModeId) => ({
	type: "text" as const,
	text: `<system-reminder>Current mode: ${MODES[id].label}</system-reminder>`,
});

/**
 * 요청에 reminder 를 붙인다. 결과는 세션에 저장된 데이터(메시지와 모드 변경 entry 의 timestamp)만으로 정해지므로
 * 같은 히스토리에서는 요청마다 항상 같다. 이미 보낸 메시지의 내용이 나중에 바뀌면 그 뒤에 서명된
 * thinking 이 전부 prefix_binding_mismatch 로 버려진다.
 *
 * - user 메시지: 보낸 시점의 모드(modeAt)를 붙인다.
 * - 턴 도중 모드가 바뀐 경우: 바뀐 뒤 처음 오는 toolResult 에 새 모드를 붙인다. 한 번 붙으면 위치가 고정된다.
 */
export function annotateMessages(messages: any[], changes: { at: number; mode: ModeId }[]): any[] {
	const modeAt = (t: number): ModeId => {
		let found: ModeId = DEFAULT;
		for (const c of changes) if (c.at <= t) found = c.mode;
		return found;
	};
	let prevTs: number | undefined;
	return messages.map((m: any) => {
		const ts = typeof m.timestamp === "number" ? m.timestamp : undefined;
		const before = prevTs;
		if (ts !== undefined) prevTs = ts;
		if (ts === undefined) return m;
		if (m.role === "user") {
			const content = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
			return { ...m, content: [...content, reminderBlock(modeAt(ts))] };
		}
		if (m.role === "toolResult" && before !== undefined && Array.isArray(m.content)) {
			const now = modeAt(ts);
			if (now !== modeAt(before)) return { ...m, content: [...m.content, reminderBlock(now)] };
		}
		return m;
	});
}

export default function (pi: ExtensionAPI) {
	let mode: ModeId = DEFAULT;
	const g = globalThis as any;

	const render = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const m = MODES[mode];
		// local-packages/nofs-theme/input-box.ts 가 읽어서 입력창 테두리/색에 반영
		g.__piAgentMode = { id: mode, label: m.label, icon: m.icon, rgb: m.rgb, style: m.style };
		if (g.__piInputBox?.active) {
			ctx.ui.setWidget("agent-mode", undefined);
			g.__piInputBox.requestRender?.();
		} else {
			// 커스텀 입력창이 없을 때만 입력창 위에 따로 표시
			ctx.ui.setWidget("agent-mode", [m.style(` ${m.icon} ${m.label} `)]);
		}
	};

	const setMode = (next: ModeId, ctx: ExtensionContext) => {
		mode = next;
		pi.appendEntry(ENTRY, { mode });
		render(ctx);
	};

	pi.on("session_start", (_event, ctx) => {
		mode = DEFAULT;
		for (const e of ctx.sessionManager.getEntries() as any[]) {
			if (e.type === "custom" && e.customType === ENTRY && e.data?.mode in MODES) mode = e.data.mode;
		}
		render(ctx);
	});

	pi.registerShortcut("shift+tab", {
		description: `Cycle agent mode (${IDS.join("/")})`,
		handler: async (ctx) => setMode(IDS[(IDS.indexOf(mode) + 1) % IDS.length], ctx),
	});

	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.agent_modes = MODES_PROMPT;
	});

	// reminder 는 세션에 저장하지 않고 요청 직전에만 각 user 메시지 끝에 붙인다.
	// custom_message 로 저장하면 투영(projection)이 만들어질 때마다 새 객체가 되어
	// pi 의 캐시 워머가 "conversation context changed" 로 멈춘다.
	// 어떤 메시지도 한 번 붙은 reminder 가 나중에 바뀌지 않게 한다(annotateMessages 참고).
	pi.on("context", (event, ctx) => {
		const changes: { at: number; mode: ModeId }[] = [];
		for (const e of ctx.sessionManager.getEntries() as any[]) {
			if (e.type === "custom" && e.customType === ENTRY && e.data?.mode in MODES) {
				changes.push({ at: Date.parse(e.timestamp), mode: e.data.mode });
			}
		}

		// 예전 버전이 저장해 둔 reminder 는 중복되므로 요청에서만 뺀다.
		const messages = event.messages.filter((m: any) => !(m.role === "custom" && m.customType === REMINDER));
		return { messages: annotateMessages(messages, changes) };
	});
}
