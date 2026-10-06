import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { type EditorTheme, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
	ANIM_MS,
	animatedLabel,
	bold,
	dim,
	fg,
	formatRemaining,
	ORANGE,
	type RGB,
	RED,
	thinkingLabel,
	timerBar,
	timerColor,
} from "./colors.ts";

// 입력창 + 채팅 내 메시지 박스 (위아래 가로선만, 좌우 세로선 없음 → 복사할 때 안 끼게)
//   ━━  PLAN  ━━ ctx 11% ━━━━━━━━━━━━━━━━━━━━━━━━━━━
//
//   입력 내용
//
//   claude-opus-4  anthropic  high
//   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// - 위 테두리: 에이전트 모드 라벨(nofs-agent-modes 가 globalThis.__piAgentMode 로 전달) + 컨텍스트 사용률
// - 테두리는 모드 색, 안쪽 배경은 모드 색을 연하게 tint (라이트 테마 기준)
// - 채팅의 내 메시지: 검은 가로선 + 옅은 회색 배경, 위 테두리에 무지개 사용자 이름

const LINE = "━";
const TINT = 0.8; // 0 = 원색, 1 = 흰색. 높을수록 연함
const USER_NAME = "notforsaleyo";

// 컨텍스트 경고 기준 (%). Claude 처럼 컨텍스트 큰 모델 기준으로 낮게 잡음
const CTX_LEVELS: [number, RGB][] = [
	[25, RED],
	[15, ORANGE],
	[8, [190, 150, 0]],
];

// 캐시 타이머 설정 (config.json). 없거나 깨지면 기본값
function loadTimerConfig(): { seconds: number; width: number } {
	const def = { seconds: 300, width: 20 };
	try {
		const c = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
		const seconds = Number(c.cacheTimerSeconds);
		const width = Number(c.cacheTimerWidth);
		return {
			seconds: seconds > 0 ? seconds : def.seconds,
			width: width >= 2 ? Math.floor(width) : def.width,
		};
	} catch {
		return def;
	}
}

const inputBorder = (rgb?: RGB) => (s: string) => (rgb ? fg(rgb, s) : `\x1b[37m${s}\x1b[39m`);
const MSG_BORDER = (s: string) => `\x1b[30m${s}\x1b[39m`; // 터미널 테마 black
const MSG_BG = "\x1b[48;2;238;238;238m"; // 옅은 회색 배경

function tintBg(rgb?: RGB): string {
	if (!rgb) return "";
	const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * TINT));
	return `\x1b[48;2;${r};${g};${b}m`;
}

// 박스 한 줄: 배경만 칠함. 오른쪽 공백은 줄 끝이라 복사할 때 보통 잘림. 중간에 리셋이 나와도 배경을 다시 칠함
function boxRow(text: string, inner: number, bg: string): string {
	const fitted = truncateToWidth(text, inner, "");
	const pad = " ".repeat(Math.max(0, inner + 1 - visibleWidth(fitted)));
	return bg ? `${bg}${fitted.replace(/\x1b\[(0|49)?m/g, (m) => m + bg)}${pad}\x1b[0m` : `${fitted}${pad}`;
}

// ── 채팅 내 메시지 박스 (UserMessageComponent.render 를 감쌈, 실패하면 원래 모양) ──
const ORIG = Symbol.for("pi.inputBox.userMessageRender");

function renderUserMessage(inst: any, width: number): string[] {
	const inner = width - 1; // 내용 + 오른쪽 공백 1칸
	const md = inst.children?.[0]?.children?.[0];
	const lines: string[] =
		md && typeof md.render === "function" ? [...md.render(inner)] : wrapTextWithAnsi(String(inst.text ?? ""), inner);
	while (lines.length > 1 && lines[lines.length - 1]!.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") lines.pop();

	const row = (l: string) => boxRow(l, inner, MSG_BG);
	return [
		// ━━ name ━━━━━ : 이름이 위 테두리 안에 들어감
		`${MSG_BORDER(`${LINE}${LINE} `)}${animatedLabel(USER_NAME)}${MSG_BORDER(` ${LINE.repeat(Math.max(0, width - USER_NAME.length - 5))}`)}`,
		row(""),
		...(lines.length ? lines : [""]).map(row),
		row(""),
		MSG_BORDER(LINE.repeat(width)),
	];
}

function installUserMessageBox(): void {
	const proto = UserMessageComponent.prototype as any;
	if (!proto[ORIG]) proto[ORIG] = proto.render;
	const original = proto[ORIG];
	proto.render = function (width: number) {
		if (typeof width !== "number" || width < 12) return original.call(this, width);
		try {
			return renderUserMessage(this, width);
		} catch {
			return original.call(this, width);
		}
	};
}

export default function (pi: ExtensionAPI) {
	const g = globalThis as any;
	installUserMessageBox();

	pi.on("message_end", (event) => {
		if ((event.message as any)?.role === "assistant") g.__piCacheTimerAt = Date.now();
	});

	pi.on("session_shutdown", () => {
		g.__piInputBox = undefined;
		if (g.__piUserLabelTimer) clearInterval(g.__piUserLabelTimer);
		g.__piUserLabelTimer = undefined;
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const shared = { active: true, requestRender: undefined as undefined | (() => void) };
		const timerCfg = loadTimerConfig();
		g.__piCacheTimerAt = undefined;
		g.__piInputBox = shared;
		// 채팅의 사용자 이름(과 추론 강도 max 라벨) 애니메이션용. footer 도 같이 다시 그려지므로 footer 는 계산을 캐시함
		if (g.__piUserLabelTimer) clearInterval(g.__piUserLabelTimer);
		g.__piUserLabelTimer = setInterval(() => shared.requestRender?.(), ANIM_MS);
		ctx.ui.setWidget("agent-mode", undefined); // 모드 라벨은 테두리에 표시

		class InputBox extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: 0 });
				shared.requestRender = () => tui.requestRender();
			}

			private contextLabel(): string {
				const usage = ctx.getContextUsage();
				if (usage?.percent == null) return dim("ctx ?");
				const pct = Math.round(usage.percent);
				const text = `ctx ${pct}%`;
				const color = CTX_LEVELS.find(([min]) => pct >= min)?.[1];
				return bold(color ? fg(color, text) : text);
			}

			private cacheTimer(border: (s: string) => string): string {
				const lastAssistantAt: number | undefined = g.__piCacheTimerAt; // 마지막 어시스턴트 응답 시각 = 프롬프트 캐시 갱신 시점
				if (lastAssistantAt === undefined) return "";
				const ttl = timerCfg.seconds * 1000;
				const left = Math.max(0, ttl - (Date.now() - lastAssistantAt));
				const frac = left / ttl;
				const label = bold(fg(timerColor(frac), formatRemaining(left)));
				return `${label}${border(` ${LINE}${LINE} `)}${timerBar(frac, timerCfg.width)}`;
			}

			render(width: number): string[] {
				if (width < 12) return super.render(width);
				const inner = width - 1; // 내용 + 오른쪽 공백 1칸
				const raw = super.render(inner);
				const visibleCount: number = (this as any).renderedVisibleLineCount ?? Math.max(1, raw.length - 2);
				const content = raw.slice(1, 1 + visibleCount);
				const below = raw.slice(2 + visibleCount); // 자동완성 목록

				const mode = g.__piAgentMode as
					| { label: string; icon: string; rgb: RGB; style: (s: string) => string }
					| undefined;
				const bg = tintBg(mode?.rgb);
				const border = inputBorder(mode?.rgb);
				const row = (text: string) => boxRow(text, inner, bg);

				// 위 테두리: ━━ [MODE] ━━ ctx N% ━━━━━━━━
				const modeLabel = mode ? mode.style(` ${mode.icon} ${mode.label} `) : "";
				const left = `${border(`${LINE}${LINE} `)}${modeLabel}${border(` ${LINE}${LINE} `)}${this.contextLabel()}${border(" ")}`;
				// 캐시 타이머는 공간이 충분할 때만: ━━ PLAN ━━ ctx 11% ━━ 4:32 ▰▰▰▱▱ ━━━━
				const timer = this.cacheTimer(border);
				const timerPart = timer ? `${border(`${LINE}${LINE} `)}${timer}${border(" ")}` : "";
				const head = timerPart && width - visibleWidth(left) - visibleWidth(timerPart) >= 2 ? left + timerPart : left;
				const top = `${head}${border(LINE.repeat(Math.max(1, width - visibleWidth(head))))}`;
				const bottom = border(LINE.repeat(width));

				const model = ctx.model;
				const meta = model
					? `${bold(model.name ?? model.id)}  ${dim(model.provider)}  ${thinkingLabel(pi.getThinkingLevel())}`
					: dim("no model");

				return [top, row(""), ...content.map(row), row(""), row(meta), bottom, ...below.map((l) => `  ${l}`)];
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => new InputBox(tui, theme, keybindings));
	});
}
