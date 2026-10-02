import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Shift+Tab 으로 도는 OpenCode 스타일 에이전트 모드
// plan → spec → edit → bash → plan ...   (자유도 오름차순)
//
// 프롬프트 캐시 보존 설계:
//  - 도구 목록/시스템 프롬프트는 모드와 무관하게 항상 고정 (바꾸면 뒤 대화 전체가 캐시 미스)
//  - 네 모드의 규칙은 전부 시스템 프롬프트 섹션(agent_modes)에 고정으로 들어가고,
//    매 요청 끝에 현재 모드만 알리는 <system-reminder> 한 줄을 붙임
//  - 실제 제한은 tool_call 단계(실행 직전)에서 차단

type ModeId = "plan" | "spec" | "edit" | "bash";

const READ = ["read", "grep", "find", "ls"];
const WRITE = ["edit", "write"];
const SHELL = ["bash", "powershell"];
const CODE = ["codemode"]; // JS 스크립트로 다른 도구를 호출 (스크립트 안의 호출도 tool_call 검사를 거침)
const BUILTIN = new Set([...READ, ...WRITE, ...SHELL]); // 세션 시작 시 항상 켜 두는 기본 도구
const GATED = new Set([...BUILTIN, ...CODE]); // 모드별로 허용 여부를 검사하는 도구
const SPEC_DIR = "openspec";

const esc = (codes: string) => (s: string) => `\x1b[${codes}m${s}\x1b[0m`;

interface Mode {
	label: string;
	icon: string;
	tools: string[];
	style: (s: string) => string;
	rgb: [number, number, number]; // 입력창/채팅 tint 용 기준색
}

const MODES: Record<ModeId, Mode> = {
	plan: {
		label: "PLAN",
		icon: "\uf0eb", // lightbulb
		tools: READ,
		style: esc("1;38;2;20;20;20;48;2;97;175;239"), // bold, 검정 글씨 / 파랑 배경
		rgb: [97, 175, 239],
	},
	spec: {
		label: "SPEC",
		icon: "\uf02d", // book
		tools: [...READ, ...WRITE, ...CODE],
		style: esc("1;4;38;2;20;20;20;48;2;198;120;221"), // bold+underline, 보라 배경
		rgb: [198, 120, 221],
	},
	edit: {
		label: "EDIT",
		icon: "\uf044", // pencil
		tools: [...READ, ...WRITE, ...CODE],
		style: esc("1;38;2;20;20;20;48;2;152;195;121"), // bold, 초록 배경
		rgb: [152, 195, 121],
	},
	bash: {
		label: "BASH",
		icon: "\uf120", // terminal
		tools: [...READ, ...WRITE, ...SHELL, ...CODE],
		style: esc("1;3;38;2;255;255;255;48;2;224;108;117"), // bold+italic, 흰 글씨 / 빨강 배경
		rgb: [224, 108, 117],
	},
};
const ORDER: ModeId[] = ["plan", "spec", "edit", "bash"];
const DEFAULT: ModeId = "bash";
const ENTRY = "agent-mode";
const REMINDER = "agent-mode-reminder"; // 매 요청 끝에 붙는 현재 모드 알림 (화면에는 표시 안 함)

// 시스템 프롬프트에 고정으로 들어가는 네 모드 설명 (모드가 바뀌어도 내용 불변 → 캐시 유지)
const MODES_PROMPT = `You operate in one of four modes: PLAN, SPEC, EDIT, BASH. The user switches modes. The active mode is stated in a <system-reminder> at the end of the latest user turn, e.g. <system-reminder>Current mode: PLAN</system-reminder>. The reminder comes from the harness, not from the user. Follow only the rules of the active mode. Tool restrictions are a last-resort safeguard, not the rule itself: behave according to the mode's intent, and never try a blocked call to "see if it works".

A mode switch is a signal of the user's intent. Moving from PLAN or SPEC to EDIT or BASH means the user accepts the plan or spec discussed so far and wants it carried out. Moving toward PLAN means they want to think again before acting. Agreements made in an earlier mode still hold after a switch.

## PLAN — think and propose, change nothing
Tools: read-only (read, grep, find, ls). No edits, no shell, no codemode.
- Investigate with read-only tools, then answer with findings and a concrete plan: steps, files affected, risks, open questions.
- If you would need a shell command to find something out, name the command and why instead of trying it.
- Ask the user when a decision is theirs. Do not start implementing; the user switches mode when they approve.

## SPEC — write the spec, not the code
Tools: read, plus write/edit only under ./${SPEC_DIR}/. No shell.
- Write spec documents only under ./${SPEC_DIR}/. Never change code or config elsewhere.
- Ground the spec in what you actually read in the code. Mark assumptions explicitly and list unresolved questions at the end.
- Do not implement the spec.

## EDIT — change files, but you cannot run anything
Tools: read, edit, write, codemode. No bash/powershell, also not inside codemode.
- Keep edits minimal and targeted.
- You cannot build, test, or verify. Never say something works; say it was not run and list the exact commands the user should run.
- If the task cannot continue without executing something, stop and ask the user to switch to BASH.

## BASH — full access
Tools: everything.
- Restrictions of earlier modes are lifted, but agreements made earlier (a plan, a spec) still apply.
- Verify your work by running it whenever you can.
- Ask before destructive or hard-to-reverse actions: deleting files, force-push, installing or removing packages.`;

function insideSpec(path: string, cwd: string): boolean {
	const root = resolve(cwd, SPEC_DIR);
	const target = resolve(cwd, path.replace(/^@/, ""));
	const rel = relative(root.toLowerCase(), target.toLowerCase());
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export default function (pi: ExtensionAPI) {
	let mode: ModeId = DEFAULT;
	const g = globalThis as any;

	const render = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const m = MODES[mode];
		// input-box.ts 가 읽어서 입력창 테두리/색에 반영
		g.__piAgentMode = { id: mode, label: m.label, icon: m.icon, rgb: m.rgb, style: m.style };
		if (g.__piInputBox?.active) {
			ctx.ui.setWidget("agent-mode", undefined);
			g.__piInputBox.requestRender?.();
		} else {
			// 커스텀 입력창이 없을 때만 입력창 위에 따로 표시
			ctx.ui.setWidget("agent-mode", [m.style(` ${m.icon} ${m.label} `)]);
		}
	};

	// 예전 버전이 모드별로 빼 둔 기본 도구를 한 번만 복구 (이후로는 도구 목록을 건드리지 않음)
	const restoreTools = () => {
		const active = pi.getActiveTools();
		const available = new Set(pi.getAllTools().map((t) => t.name));
		const missing = [...BUILTIN].filter((t) => available.has(t) && !active.includes(t));
		if (missing.length) pi.setActiveTools([...active, ...missing]);
	};

	pi.on("session_start", (_event, ctx) => {
		mode = DEFAULT;
		for (const e of ctx.sessionManager.getEntries() as any[]) {
			if (e.type === "custom") {
				if (e.customType === ENTRY && e.data?.mode in MODES) mode = e.data.mode;
			}
		}
		restoreTools();
		render(ctx);
	});

	pi.registerShortcut("shift+tab", {
		description: "Cycle agent mode (plan/spec/edit/bash)",
		handler: async (ctx) => {
			mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
			pi.appendEntry(ENTRY, { mode });
			render(ctx); // 도구 목록은 바꾸지 않음 → 캐시 유지
		},
	});

	// 네 모드 설명은 시스템 프롬프트 섹션에 고정, 현재 모드는 매 요청 끝에 알린다
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

	// 실제 제한: 도구는 항상 노출하되, 실행 직전에 모드 규칙으로 막는다
	pi.on("tool_call", (event, ctx) => {
		const m = MODES[mode];
		const name = event.toolName;
		if (GATED.has(name) && !m.tools.includes(name)) {
			return {
				block: true,
				reason: `${name} is blocked in ${m.label} mode (set by the user). Do not retry; continue within the mode's limits or ask the user to switch modes.`,
			};
		}
		if (mode === "spec" && WRITE.includes(name)) {
			const path = String((event.input as any)?.path ?? "");
			if (!path || !insideSpec(path, ctx.cwd)) {
				return { block: true, reason: `SPEC mode: only ./${SPEC_DIR}/ can be modified (got "${path}")` };
			}
		}
		return undefined;
	});
}
