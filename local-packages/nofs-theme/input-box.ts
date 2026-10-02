import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type EditorTheme, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// 직각 네모 입력창 + 채팅 내 메시지 박스
//   ┏━  PLAN ── ctx 11% ───────────────────────────┐
//   │                                                │
//   │ 입력 내용                                      │
//   │                                                │
//   │ gpt-6.1-sol  openai-codex  high                │
//   └────────────────────────────────────────────────┘
// - 좌측 상단: 에이전트 모드 라벨(agent-modes.ts) + 컨텍스트 사용률
// - 테두리: 굵은 선, 모드 색을 어둡게 (좌우 세로선 없음)
// - 안쪽 배경: 모드 색을 연하게 tint (라이트 테마 기준)
// - 채팅의 내 메시지: 색 없이 검은 굵은 박스, 위아래 여백
// - 추론 강도: low 초록 / medium 청록 / high 굵은 노랑 / xhigh 굵은 빨강 / max 굵은 무지개

type RGB = [number, number, number];

const BOX = { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" };
const TINT = 0.8; // 0 = 원색, 1 = 흰색. 높을수록 연함

// 컨텍스트 경고 기준 (%). Claude 처럼 컨텍스트 큰 모델 기준으로 낮게 잡음
const CTX_WARN = 8; // 노랑
const CTX_HIGH = 15; // 주황
const CTX_CRIT = 25; // 빨강

const inputBorder = (rgb?: RGB) => (s: string) =>
	rgb
		? `\x1b[38;2;${rgb.join(";")}m${s}\x1b[39m` // 라벨과 같은 색
		: `\x1b[37m${s}\x1b[39m`;
const MSG_BORDER = (s: string) => `\x1b[30m${s}\x1b[39m`; // 터미널 테마 black
const MSG_BG = "\x1b[48;2;238;238;238m"; // 옅은 회색 배경

const RAINBOW: RGB[] = [
	[230, 57, 70],
	[244, 140, 6],
	[214, 170, 0],
	[56, 176, 0],
	[0, 150, 199],
	[86, 90, 220],
	[176, 70, 200],
];

const fg = (rgb: RGB, s: string) => `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${s}\x1b[39m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

function rainbow(text: string): string {
	return bold([...text].map((c, i) => fg(RAINBOW[i % RAINBOW.length]!, c)).join(""));
}

// medium 부터 번개 1개, 이후 단계마다 1개씩 추가. footer.ts 에서도 재사용
const BOLT = "\uf0e7";
const BOLT_COUNT: Record<string, number> = { medium: 1, high: 2, xhigh: 3, max: 4 };

export function thinkingLabel(level: string): string {
	const bolts = BOLT.repeat(BOLT_COUNT[level] ?? 0);
	const text = bolts ? `${bolts} ${level}` : level;
	switch (level) {
		case "low":
			return fg([56, 150, 60], text);
		case "medium":
			return fg([0, 150, 170], text);
		case "high":
			return bold(fg([190, 140, 0], text));
		case "xhigh":
			return bold(fg([220, 0, 0], text));
		case "max":
			return animatedLabel(text);
		default:
			return `\x1b[2m${level}\x1b[22m`;
	}
}

function tintBg(rgb?: RGB): string {
	if (!rgb) return "";
	const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * TINT));
	return `\x1b[48;2;${r};${g};${b}m`;
}

// USER 라벨: 무지개색이 시간에 따라 흐르고, 밝은 하이라이트가 지나감 (rainbow-editor 예제와 같은 방식)
const ANIM_MS = 100;
function animatedLabel(text: string): string {
	const t = Date.now() / ANIM_MS;
	const shift = Math.floor(t / 2);
	const shine = Math.floor(t) % (text.length + 8) - 2; // 지나가는 하이라이트 위치 (일부 구간은 쉼)
	return bold(
		[...text]
			.map((c, i) => {
				const base = RAINBOW[(i + shift) % RAINBOW.length]!;
				const d = Math.abs(i - shine);
				const f = d === 0 ? 0.6 : d === 1 ? 0.3 : 0;
				return fg(base.map((v) => Math.round(v + (255 - v) * f)) as RGB, c);
			})
			.join(""),
	);
}

// 입력창 한 줄. 좌우 세로선/왼쪽 공백 없음(복사 시 안 끼게), 배경 tint 만 칠함.
// 오른쪽 공백은 줄 끝이라 복사할 때 보통 잘림. 중간에 리셋이 나와도 tint 를 다시 칠함
function boxRow(text: string, inner: number, bg: string): string {
	const fitted = truncateToWidth(text, inner, "");
	const pad = " ".repeat(Math.max(0, inner + 1 - visibleWidth(fitted)));
	return bg ? `${bg}${fitted.replace(/\x1b\[(0|49)?m/g, (m) => m + bg)}${pad}\x1b[0m` : `${fitted}${pad}`;
}

// ── 채팅 내 메시지 박스 (UserMessageComponent.render 를 감쌈, 실패하면 원래 모양) ──
const ORIG = Symbol.for("pi.inputBox.userMessageRender");

function renderUserMessage(inst: any, width: number): string[] {
	const inner = width - 1; // 내용 + 오른쪽 공백 1칸 (좌우 세로선 없음)
	const text: string = String(inst.text ?? "");
	const md = inst.children?.[0]?.children?.[0];
	const lines: string[] =
		md && typeof md.render === "function" ? [...md.render(inner)] : wrapTextWithAnsi(text, inner);
	while (lines.length > 1 && lines[lines.length - 1]!.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") lines.pop();

	const row = (l: string) => {
		return boxRow(l, inner, MSG_BG);
	};
	const name = "notforsaleyo";
	return [
		// ━━ name ━━━━━ : 라벨이 윗 테두리 안에 들어감
		`${MSG_BORDER(`${BOX.h}${BOX.h} `)}${animatedLabel(name)}${MSG_BORDER(` ${BOX.h.repeat(Math.max(0, width - name.length - 5))}`)}`,
		row(""),
		...(lines.length ? lines : [""]).map(row),
		row(""),
		MSG_BORDER(BOX.h.repeat(width)),
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

	pi.on("session_shutdown", () => {
		g.__piInputBox = undefined;
		if (g.__piUserLabelTimer) clearInterval(g.__piUserLabelTimer);
		g.__piUserLabelTimer = undefined;
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const shared = { active: true, requestRender: undefined as undefined | (() => void) };
		g.__piInputBox = shared;
		if (g.__piUserLabelTimer) clearInterval(g.__piUserLabelTimer);
		g.__piUserLabelTimer = setInterval(() => shared.requestRender?.(), ANIM_MS); // USER 라벨 애니메이션용
		ctx.ui.setWidget("agent-mode", undefined); // 모드 라벨은 테두리에 표시

		class InputBox extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: 0 });
				shared.requestRender = () => tui.requestRender();
			}

			private contextLabel(): string {
				const usage = ctx.getContextUsage();
				if (!usage || usage.percent === null || usage.percent === undefined) return "\x1b[2mctx ?\x1b[22m";
				const pct = Math.round(usage.percent);
				const text = `ctx ${pct}%`;
				if (pct >= CTX_CRIT) return bold(fg([220, 0, 0], text));
				if (pct >= CTX_HIGH) return bold(fg([230, 110, 0], text));
				if (pct >= CTX_WARN) return bold(fg([190, 150, 0], text));
				return bold(text);
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

				// 위 테두리: ━━ [MODE] ━━ ctx N% ━━━━━━━━ (모서리도 일자 글리프)
				const modeLabel = mode ? mode.style(` ${mode.icon} ${mode.label} `) : "";
				const left = `${border(`${BOX.h}${BOX.h} `)}${modeLabel}${border(` ${BOX.h}${BOX.h} `)}${this.contextLabel()}${border(" ")}`;
				const fill = Math.max(1, width - visibleWidth(left));
				const top = `${left}${border(BOX.h.repeat(fill))}`;
				const bottom = border(BOX.h.repeat(width));

				const model = ctx.model;
				const meta = model
					? `${bold(model.name ?? model.id)}  \x1b[2m${model.provider}\x1b[22m  ${thinkingLabel(pi.getThinkingLevel())}`
					: "\x1b[2mno model\x1b[22m";

				return [top, row(""), ...content.map(row), row(""), row(meta), bottom, ...below.map((l) => `  ${l}`)];
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => new InputBox(tui, theme, keybindings));
	});
}
