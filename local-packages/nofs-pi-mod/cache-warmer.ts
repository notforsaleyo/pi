import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// /warm [once|on|off]: 내장 idle 캐시 워머를 수동 전용으로 쓴다.
//   (인자 없음): 현재 상태만 안내
//   once: 다음 메시지 전까지만 워밍
//   on: 메시지와 상관없이 항상 워밍
//   off: 워밍하지 않음 (기본)
// 켜지 않았을 때는 내장 경제성 판단을 덮어써서 항상 중단(stop)한다. 상태는 저장하지 않고 세션이 시작되면 off 로 돌아간다.
// OpenAI 계열 모델은 워밍이 필요 없으므로 켤 수 없고, 판단 시점에도 항상 중단한다.
// 워밍 요청, 주기(TTL의 90%), 30분 상한, 사용량 기록은 모두 pi 내장 동작을 그대로 쓴다.
// 전제: settings.json 의 cacheWarming 이 "idle" 이어야 한다. ("off" 면 워밍 run 자체가 만들어지지 않아 /warm 이 동작하지 않는다.)
// 주의: 이 확장이 로드되지 않거나 핸들러가 실패하면 pi 내장 판단으로 되돌아가 자동 워밍이 일어날 수 있다.
// 제약: stop 은 다음 실제 요청 전까지 되돌릴 수 없으므로, 마지막 요청 후 첫 판단 전에 켜야 효과가 있다.
// 표시: globalThis.__piWarm 으로 상태를 공유하고, nofs-theme/input-box.ts 가 입력창 위 테두리에 그린다.
// 워밍을 보내기로 하면 globalThis.__piCacheTimerAt 을 지금으로 리셋해 입력창 캐시 타이머와 맞춘다.

type Mode = "off" | "once" | "on";

const isOpenAI = (provider?: string) => !!provider && (provider === "openai" || provider.startsWith("openai-"));

export default function (pi: ExtensionAPI) {
	const g = globalThis as any;
	let mode: Mode = "off";
	let count = 0;

	const publish = () => {
		g.__piWarm = { mode, count };
		g.__piInputBox?.requestRender?.();
	};

	const set = (next: Mode) => {
		mode = next;
		count = 0;
		publish();
	};

	pi.registerCommand("warm", {
		description: "Cache warming: /warm [once|on|off] (once = until next message, on = always, off = never; session only)",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (!value) {
				const label = { off: "꺼짐", once: "켜짐 (once, 다음 메시지 전까지)", on: "켜짐 (on, 항상)" }[mode];
				ctx.ui.notify(`캐시 워밍 ${label}. 사용법: /warm [once|on|off]`, "info");
				return;
			}
			if (value !== "once" && value !== "on" && value !== "off") {
				ctx.ui.notify("사용법: /warm [once|on|off]", "warning");
				return;
			}
			if (value !== "off" && isOpenAI(ctx.model?.provider)) {
				set("off");
				ctx.ui.notify("OpenAI 모델은 캐시 워밍이 필요 없어 켤 수 없습니다", "warning");
				return;
			}
			set(value);
			ctx.ui.notify(
				value === "on"
					? "캐시 워밍 항상 켜짐 (현재 세션)"
					: value === "once"
						? "캐시 워밍 켜짐 (다음 메시지 전까지, 최대 30분)"
						: "캐시 워밍 꺼짐",
				"info",
			);
		},
	});

	pi.on("cache_warming_decision", (_event, ctx) => {
		if (mode === "off" || isOpenAI(ctx.model?.provider)) return { action: "stop" };
		count++;
		g.__piCacheTimerAt = Date.now(); // 워밍 요청이 캐시를 갱신하므로 입력창 타이머도 리셋
		publish();
		return { action: "warm" };
	});

	// 슬래시 명령은 "다음 메시지"로 보지 않는다. on 은 메시지가 와도 유지한다.
	pi.on("input", (event) => {
		if (mode === "once" && !event.text.trimStart().startsWith("/")) set("off");
	});

	pi.on("session_start", () => set("off"));
	pi.on("session_shutdown", () => {
		mode = "off";
		count = 0;
		g.__piWarm = undefined;
	});
}
