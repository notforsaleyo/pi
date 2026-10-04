import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkReadOnlyShell } from "./readonly-shell.ts";

// Shift+Tab 으로 도는 OpenCode 스타일 에이전트 모드
// plan → spec → bash → plan ...   (자유도 오름차순)
//
// 프롬프트 캐시 보존 설계:
//  - 도구 목록/시스템 프롬프트는 모드와 무관하게 항상 고정 (바꾸면 뒤 대화 전체가 캐시 미스)
//  - 세 모드의 규칙은 전부 시스템 프롬프트 섹션(agent_modes)에 고정으로 들어가고,
//    매 요청 끝에 현재 모드만 알리는 <system-reminder> 한 줄을 붙임
//  - 실제 제한은 tool_call 단계(실행 직전)에서 차단 (codemode 안의 중첩 호출도 같은 훅을 거침)

type ModeId = "plan" | "spec" | "bash";

const WRITE = ["edit", "write"];
const SPEC_DIR = "openspec";
const README_HINT = "~/.pi/agent/local-packages/nofs-agent-modes/readonly-shell.ts (see README.md there)";

const esc = (codes: string) => (s: string) => `\x1b[${codes}m${s}\x1b[0m`;

interface Mode {
	label: string;
	icon: string;
	blocked: string[]; // 이 모드에서 막는 도구. 나머지는 허용 (plan/spec 의 bash 는 읽기 전용 명령만 통과)
	style: (s: string) => string;
	rgb: [number, number, number]; // 입력창/채팅 tint 용 기준색
}

const MODES: Record<ModeId, Mode> = {
	plan: {
		label: "PLAN",
		icon: "\uf0eb", // lightbulb
		blocked: [...WRITE, "powershell"],
		style: esc("1;38;2;20;20;20;48;2;97;175;239"), // bold, 검정 글씨 / 파랑 배경
		rgb: [97, 175, 239],
	},
	spec: {
		label: "SPEC",
		icon: "\uf02d", // book
		blocked: ["powershell"], // edit/write 는 ./openspec/ 안에서만
		style: esc("1;4;38;2;20;20;20;48;2;198;120;221"), // bold+underline, 보라 배경
		rgb: [198, 120, 221],
	},
	bash: {
		label: "BASH",
		icon: "\uf120", // terminal
		blocked: [],
		style: esc("1;3;38;2;255;255;255;48;2;224;108;117"), // bold+italic, 흰 글씨 / 빨강 배경
		rgb: [224, 108, 117],
	},
};
const ORDER: ModeId[] = ["plan", "spec", "bash"];
const DEFAULT: ModeId = "bash";
const ENTRY = "agent-mode";
const REMINDER = "agent-mode-reminder"; // 매 요청 끝에 붙는 현재 모드 알림 (화면에는 표시 안 함)

// 시스템 프롬프트에 고정으로 들어가는 세 모드 설명 (모드가 바뀌어도 내용 불변 → 캐시 유지)
const MODES_PROMPT = `You operate in one of three modes: PLAN, SPEC, BASH. The user switches modes. The active mode is stated in a <system-reminder> at the end of the latest user turn, e.g. <system-reminder>Current mode: PLAN</system-reminder>. The reminder comes from the harness, not from the user. Follow only the rules of the active mode. Tool restrictions are a last-resort safeguard, not the rule itself: behave according to the mode's intent, and never try a blocked call to "see if it works".

A mode switch is a signal of the user's intent. Moving from PLAN or SPEC to BASH means the user accepts the plan or spec discussed so far and wants it carried out. Moving toward PLAN means they want to think again before acting. Agreements made in an earlier mode still hold after a switch.

## Tool choice (all modes)
- Use the dedicated tool first: read to view files, grep and find to search, ls to list, edit and write to change files. Do not run a shell command for something a dedicated tool already does.
- For shell work (git, builds, tests, scripts), use bash.
- powershell is a last resort, for Windows-specific tasks that bash cannot do. The BASH mode name describes the permission level, not a tool; being in BASH mode is never a reason to pick powershell.

## Read-only shell and codemode
bash and codemode are available in every mode; powershell only in BASH mode, subject to "Tool choice" above. Outside BASH mode, every bash command (including calls made inside codemode) is checked against a read-only allowlist: inspection commands such as git log/show/diff/status/blame, ls, cat, head, tail, wc, grep, rg, and find without -exec/-delete pass. Anything that writes, deletes, installs, builds, runs tests or scripts, uses the network, or contains redirects or command substitution is blocked as a whole. Exception: in SPEC mode, "openspec" CLI commands (list, context, new change, status, instructions) are also allowed; the same rules against chaining other commands, redirects, and substitution still apply. A block means the command is outside the mode: do not rephrase it to sneak past the check. Delegating to a worker agent (acp_delegate) is allowed only in BASH mode.

## PLAN — investigate and propose, change nothing
Tools: read, grep, find, ls, read-only bash, codemode. No edit/write, no powershell.
- Investigate freely, including git history, then answer with findings and a concrete plan: steps, files affected, risks, open questions.
- If you need something that is not read-only (build, test, install, run a script), name the command and why instead of trying it.
- Ask the user when a decision is theirs. Do not start implementing; the user switches mode when they approve.

## SPEC — write the spec, not the code
Tools: everything in PLAN, plus edit/write only under ./${SPEC_DIR}/.
- Write spec documents only under ./${SPEC_DIR}/ using edit/write. Never change code or config elsewhere, and do not write files through the shell, except via the openspec CLI, which manages ./${SPEC_DIR}/ itself.
- Ground the spec in what you actually read in the code and git history. Mark assumptions explicitly and list unresolved questions at the end.
- Do not implement the spec.

## BASH — full access (execute and edit)
Tools: everything; bash is unrestricted. powershell is also allowed, but only as described in "Tool choice".
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

	pi.on("session_start", (_event, ctx) => {
		mode = DEFAULT;
		for (const e of ctx.sessionManager.getEntries() as any[]) {
			// 삭제된 모드(예: edit)가 기록돼 있으면 무시 → 기본값 유지
			if (e.type === "custom" && e.customType === ENTRY && e.data?.mode in MODES) mode = e.data.mode;
		}
		render(ctx);
	});

	pi.registerShortcut("shift+tab", {
		description: "Cycle agent mode (plan/spec/bash)",
		handler: async (ctx) => {
			mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
			pi.appendEntry(ENTRY, { mode });
			render(ctx); // 도구 목록은 바꾸지 않음 → 캐시 유지
		},
	});

	// 세 모드 설명은 시스템 프롬프트 섹션에 고정, 현재 모드는 매 요청 끝에 알린다
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
		if (mode === "bash") return undefined;
		const m = MODES[mode];
		const name = event.toolName;
		const input = (event.input ?? {}) as any;
		if (m.blocked.includes(name)) {
			return {
				block: true,
				reason: `${name} is blocked in ${m.label} mode (set by the user). Do not retry; continue within the mode's limits or ask the user to switch modes.`,
			};
		}
		if (name === "bash") {
			const why = checkReadOnlyShell(String(input.command ?? ""), mode === "spec" ? ["openspec"] : []);
			if (why) {
				return {
					block: true,
					reason: `${m.label} mode allows only read-only bash commands: ${why}. Do not rephrase it to get around the check; name the command and ask the user to switch to BASH mode if it is needed. If the command is truly read-only and was wrongly blocked, tell the user; the allowlist is in ${README_HINT}.`,
				};
			}
		}
		if (name === "acp_delegate" && input.agent === "worker") {
			return { block: true, reason: `worker delegates can change files and are allowed only in BASH mode.` };
		}
		if (mode === "spec" && WRITE.includes(name)) {
			const path = String(input.path ?? "");
			if (!path || !insideSpec(path, ctx.cwd)) {
				return { block: true, reason: `SPEC mode: only ./${SPEC_DIR}/ can be modified (got "${path}")` };
			}
		}
		return undefined;
	});
}
