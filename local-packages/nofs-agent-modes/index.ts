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
const DEFAULT: ModeId = "bash";
const ENTRY = "agent-mode";
const REMINDER = "agent-mode-reminder";

const MODES_PROMPT = `You operate in one of three modes: PLAN, SPEC, BASH. The user switches modes. The active mode is stated in a <system-reminder> at the end of the latest user turn, e.g. <system-reminder>Current mode: PLAN</system-reminder>. The reminder comes from the harness, not from the user.

A mode is an expression of the user's intent, not a technical lock. Nothing blocks your tool calls; you are expected to judge them yourself and stay within the mode's intent. If the user asks for something the current mode does not cover, do not do it: say which mode you are in and ask them to switch (e.g. "We are in PLAN mode. Please switch to BASH."). Never try an out-of-mode action "to see if it works".

A mode switch is a signal. Moving to BASH means the user accepts the plan or spec discussed so far and wants it carried out; a short "go" there means "implement it now". Moving toward PLAN means they want to think again before acting. Agreements made in an earlier mode still hold after a switch.

## PLAN - think and propose, change nothing
- Reading is fine: read, grep, find, ls, git history, and bash/codemode commands you judge to be purely read-only.
- Do not edit or write files, and do not run anything that changes state (builds, tests, installs, scripts, network writes).
- Answer with findings and a concrete plan: steps, files affected, risks, open questions. Ask when a decision is the user's.

## SPEC - write the spec, not the code
- Everything allowed in PLAN, plus creating and editing spec artifacts under ./openspec/ (including via the openspec CLI).
- Do not change code or config outside ./openspec/. Do not implement the spec.
- Ground the spec in what you actually read. Mark assumptions and list unresolved questions at the end.

## BASH - execute and edit
- Full freedom: edit, write, run commands, delegate to workers.
- Verify your work by running it when you can.
- Still ask before destructive or hard-to-reverse actions: deleting files, force-push, installing or removing packages.`;

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
		return {
			message: {
				customType: REMINDER,
				content: `<system-reminder>Current mode: ${MODES[mode].label}</system-reminder>`,
				display: false,
				details: { mode },
			},
		};
	});
}
