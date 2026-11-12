import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type KeybindingsManager,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { createSubscriptionUsage } from "./subscription-usage.ts";
import { type EditorTheme, type TUI, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	ANIM_MS,
	setAnimationEnabled,
	rainbowLabel,
	bold,
	contextStep,
	dim,
	fg,
	formatRemaining,
	type RGB,
	thinkingLabel,
	timerBar,
	timerColor,
} from "./colors.ts";

// 입력창 + 채팅 내 메시지 박스 (위아래 가로선만, 좌우 세로선 없음 → 복사할 때 안 끼게)
//   ──  PLAN  ── 󰝦 11% ───────────────────────────
//
//   입력 내용
//
//   claude-opus-4  anthropic  high
//   ────────────────────────────────────────────────
// - 위 테두리: 에이전트 모드 라벨(nofs-agent-modes 가 globalThis.__piAgentMode 로 전달) + 컨텍스트 사용률
// - 테두리는 모드 색, 내부 배경은 터미널 기본 배경 (모드 tint 없음)
// - 채팅의 내 메시지: 검은 가로선 + 옅은 회색 배경, 위 테두리에 무지개 사용자 이름

const LINE = "─";
const USER_NAME = "notforsaleyo";

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

// 박스 한 줄: 배경만 칠함. 오른쪽 공백은 줄 끝이라 복사할 때 보통 잘림. 중간에 리셋이 나와도 배경을 다시 칠함
function boxRow(text: string, inner: number, bg: string): string {
	const fitted = truncateToWidth(text, inner, "");
	const pad = " ".repeat(Math.max(0, inner + 1 - visibleWidth(fitted)));
	return bg ? `${bg}${fitted.replace(/\x1b\[(0|49)?m/g, (m) => m + bg)}${pad}\x1b[0m` : `${fitted}${pad}`;
}

// ── 채팅 내 메시지 박스 (UserMessageComponent.render 를 감쌈, 실패하면 원래 모양) ──
const ORIG = Symbol.for("pi.inputBox.userMessageRender");

function renderUserMessage(inst: UserMessageComponent, width: number, original: (width: number) => string[]): string[] {
	const inner = width - 1;
	// Reuse the host's Markdown, transformers, padding and shell-integration markers.
	const lines = original.call(inst, inner);
	const top = `${MSG_BORDER(`${LINE}${LINE} `)}${rainbowLabel(USER_NAME)}${MSG_BORDER(` ${LINE.repeat(Math.max(0, width - USER_NAME.length - 5))}`)}`;
	return [
		truncateToWidth(top, width, ""),
		...lines.map((line) => boxRow(line, inner, MSG_BG)),
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
			return renderUserMessage(this, width, original);
		} catch {
			return original.call(this, width);
		}
	};
}

export default function (pi: ExtensionAPI) {
	const g = globalThis as any;
	installUserMessageBox();
	let animation = true;
	let showCacheTimer = true;
	let currentProvider: string | undefined;
	let subscription = createSubscriptionUsage();
	pi.on("after_provider_response", (event, ctx) => {
		if (ctx.model?.provider !== "anthropic") return;
		subscription.observe(event.headers);
		g.__piInputBox?.requestRender?.();
	});
	// Anthropic + PI_CACHE_RETENTION=long 이면 1시간, 아니면 config 값
	const ttlSeconds = (base: number) =>
		currentProvider === "anthropic" && process.env.PI_CACHE_RETENTION === "long" ? 3600 : base;
	let restartDisplayTimer: (() => void) | undefined;
	setAnimationEnabled(animation);

	let workingFrame = "";
	function stopWorkingIndicator(): void {
		if (g.__piWorkingTimer) clearInterval(g.__piWorkingTimer);
		g.__piWorkingTimer = undefined;
	}
	function startWorkingIndicator(ctx: ExtensionContext): void {
		stopWorkingIndicator();
		if (!ctx.hasUI) return;
		const update = () => {
			const choices = [..."▤▥▦▧▨▩"].filter((frame) => frame !== workingFrame);
			workingFrame = choices[Math.floor(Math.random() * choices.length)]!;
			ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg("muted", `${workingFrame} `)] });
		};
		update();
		g.__piWorkingTimer = setInterval(update, 180);
	}
	pi.on("agent_start", (_event, ctx) => startWorkingIndicator(ctx));
	pi.on("agent_settled", stopWorkingIndicator);

	pi.registerCommand("animation", {
		description: "Toggle name/max effort animation: /animation [on|off] (session only)",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (value && value !== "on" && value !== "off") {
				ctx.ui.notify("사용법: /animation [on|off]", "warning");
				return;
			}
			animation = value ? value === "on" : !animation;
			setAnimationEnabled(animation);
			restartDisplayTimer?.();
			g.__piInputBox?.requestRender?.();
			ctx.ui.notify(`무지개 애니메이션 ${animation ? "켜짐" : "꺼짐"} (현재 세션)`, "info");
		},
	});

	const supportsCacheTimer = (provider?: string) =>
		!!provider && provider !== "openai" && !provider.startsWith("openai-");
	pi.on("model_select", (event) => {
		showCacheTimer = supportsCacheTimer(event.model.provider);
		currentProvider = event.model.provider;
		g.__piInputBox?.requestRender?.();
	});

	pi.on("message_end", (event) => {
		if ((event.message as any)?.role === "assistant") g.__piCacheTimerAt = Date.now();
	});

	pi.on("session_shutdown", () => {
		stopWorkingIndicator();
		restartDisplayTimer = undefined;
		g.__piInputBox = undefined;
		if (g.__piCacheDisplayTimer) clearInterval(g.__piCacheDisplayTimer);
		g.__piCacheDisplayTimer = undefined;
	});

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const shared = { active: true, requestRender: undefined as undefined | (() => void) };
		subscription = createSubscriptionUsage();
		let lastUsageRender = 0;
		const timerCfg = loadTimerConfig();
		g.__piCacheTimerAt = undefined;
		g.__piInputBox = shared;
		showCacheTimer = supportsCacheTimer(ctx.model?.provider);
		currentProvider = ctx.model?.provider;
		// 애니메이션과 카운트다운이 하나의 갱신 루프를 공유한다.
		restartDisplayTimer = () => {
			if (g.__piCacheDisplayTimer) clearInterval(g.__piCacheDisplayTimer);
			g.__piCacheDisplayTimer = setInterval(() => {
				const lastAssistantAt: number | undefined = g.__piCacheTimerAt;
				const now = Date.now();
				const refreshUsage = now - lastUsageRender >= 5000;
				if (refreshUsage) lastUsageRender = now;
				if (animation || refreshUsage || (showCacheTimer && lastAssistantAt !== undefined &&
					now - lastAssistantAt <= ttlSeconds(timerCfg.seconds) * 1000 + 1000)) {
					shared.requestRender?.();
				}
			}, animation ? ANIM_MS : 1000);
		};
		restartDisplayTimer();
		ctx.ui.setWidget("agent-mode", undefined); // 모드 라벨은 테두리에 표시
		stopWorkingIndicator();
		ctx.ui.setWorkingIndicator({ frames: [ctx.ui.theme.fg("muted", "▤ ")] });
		if (!ctx.isIdle()) startWorkingIndicator(ctx);

		class InputBox extends CustomEditor {
			private appKeys: KeybindingsManager;
			private mouseGeometry: { width: number; height: number; bodyRows: number; menuRows: number } | undefined;

			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: 0 });
				this.appKeys = keybindings;
				shared.requestRender = () => tui.requestRender();
			}

			handleInput(data: string): void {
				if (this.appKeys.matches(data, "app.thinking.cycle") && ctx.model?.reasoning) {
					const levels = getSupportedThinkingLevels(ctx.model);
					if (levels.length) {
						const index = levels.indexOf(pi.getThinkingLevel() as (typeof levels)[number]);
						pi.setThinkingLevel(levels[(index + 1) % levels.length]!);
						shared.requestRender?.();
						return;
					}
				}
				super.handleInput(data);
			}

			private contextLabel(border: (s: string) => string): string {
				const usage = ctx.getContextUsage();
				const [icon] = contextStep(usage?.percent ?? 0);
				const prefix = `${border(icon)} `;
				if (usage?.percent == null) return prefix + dim(border("?"));
				return prefix + bold(border(`${Math.round(usage.percent)}%`));
			}

			// 캐시 워밍 아이콘 (nofs-pi-mod/cache-warmer.ts 가 globalThis.__piWarm 으로 전달). 너드 폰트 아이콘 뒤에는 공백 1칸.
			// off 󰑗 / once 󰑘 / on 󰑖 : 색은 현재 모드 색 (모양으로만 구분)
			private warmIcon(border: (s: string) => string): string {
				const warm = g.__piWarm as { mode: "off" | "once" | "on" } | undefined;
				if (!warm) return "";
				const icon = warm.mode === "on" ? "\u{F0456}" : warm.mode === "once" ? "\u{F0458}" : "\u{F0457}";
				return bold(border(`${icon} `));
			}

			// 캐시 타이머 구간: 3:56  ████░░░░ 󰑗  (구분 문자 없이 공백만)
			private cacheTimer(border: (s: string) => string, withWarm = true): string {
				if (!showCacheTimer) return "";
				const parts: string[] = [];
				const lastAssistantAt: number | undefined = g.__piCacheTimerAt; // 마지막 어시스턴트 응답 시각 = 프롬프트 캐시 갱신 시점
				if (lastAssistantAt !== undefined) {
					const ttl = ttlSeconds(timerCfg.seconds) * 1000;
					const left = Math.max(0, ttl - (Date.now() - lastAssistantAt));
					const frac = left / ttl;
					parts.push(bold(fg(timerColor(frac), formatRemaining(left))) + " ");
					parts.push(timerBar(frac, timerCfg.width));
				}
				const icon = withWarm ? this.warmIcon(border) : "";
				if (icon) parts.push(icon);
				return parts.join(" ");
			}

			handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
				const geometry = this.mouseGeometry;
				if (!geometry) return super.handleMouse(event);
				let y: number | undefined;
				if (event.y >= 2 && event.y < 2 + geometry.bodyRows) y = event.y - 1;
				const menuStart = geometry.bodyRows + 5;
				if (event.y >= menuStart && event.y < menuStart + geometry.menuRows) y = event.y - 3;
				// Decoration clicks focus the editor; drags remain available for text selection.
				if (y === undefined || event.x >= geometry.width) {
					return event.type === "click" && event.button === "left" ? { handled: true, focus: true } : undefined;
				}
				return super.handleMouse({ ...event, y, width: geometry.width, height: geometry.height });
			}

			render(width: number): string[] {
				if (width < 12) {
					this.mouseGeometry = undefined;
					return super.render(width);
				}
				const inner = width - 1; // 내용 + 오른쪽 공백 1칸
				const raw = super.render(inner);
				const visibleCount: number = (this as any).renderedVisibleLineCount ?? Math.max(1, raw.length - 2);
				const content = raw.slice(1, 1 + visibleCount);
				const below = raw.slice(2 + visibleCount); // 자동완성 목록
				this.mouseGeometry = { width: inner, height: raw.length, bodyRows: visibleCount, menuRows: below.length };

				const mode = g.__piAgentMode as
					| { label: string; icon: string; rgb: RGB; style: (s: string) => string }
					| undefined;
				const border = inputBorder(mode?.rgb);
				const row = (text: string) => boxRow(text, inner, "");

				// 위 테두리: ── [MODE] ── [context icon] N% ────────
				const modeLabel = mode ? mode.style(` ${mode.icon} ${mode.label} `) : "";
				const left = `${border(`${LINE}${LINE} `)}${modeLabel}${border(` ${LINE}${LINE} `)}${this.contextLabel(border)}${border(" ")}`;
				// 캐시 타이머는 공간이 충분할 때만: ── PLAN ── 󰝦 11% ── 4:32 ▰▰▰▱▱ ────
				// 공간이 모자라면 워밍 아이콘부터 빼고, 그래도 안 되면 구간 전체를 뺀다.
				let head = left;
				for (const withWarm of [true, false]) {
					const timer = this.cacheTimer(border, withWarm);
					if (!timer) continue;
					const timerPart = `${border(`${LINE}${LINE} `)}${timer}${border(" ")}`;
					if (width - visibleWidth(left) - visibleWidth(timerPart) >= 2) {
						head = left + timerPart;
						break;
					}
				}
				const top = truncateToWidth(`${head}${border(LINE.repeat(Math.max(0, width - visibleWidth(head))))}`, width, "");
				// nf-md-handshake: 자동 핸드오프가 켜진 동안만 하단 왼쪽에 표시한다.
				const bottomLeft = g.__piAutoHandoff?.enabled ? `${LINE}${LINE} \u{F1218} ` : "";
				const bottom = border(bottomLeft + LINE.repeat(Math.max(0, width - visibleWidth(bottomLeft))));

				const model = ctx.model;
				let meta = model
					? `${bold(model.name ?? model.id)}  ${dim(model.provider)}  ${thinkingLabel(pi.getThinkingLevel())}`
					: dim("no model");
				const usage = subscription.label(model);
				if (usage && visibleWidth(meta) + 2 + visibleWidth(usage) <= inner) meta += `  ${usage}`;

				return [top, row(""), ...content.map(row), row(""), row(meta), bottom, ...below];
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => new InputBox(tui, theme, keybindings));
	});
}
