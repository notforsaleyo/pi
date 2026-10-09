import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// /warm: 내장 idle 캐시 워머를 수동 전용으로 쓴다. /warm 을 켜면 다음 메시지 전까지 워밍을 계속하고,
// 켜지 않았을 때는 내장 경제성 판단을 덮어써서 항상 중단(stop)한다.
// 워밍 요청, 주기(TTL의 90%), 30분 상한, 사용량 기록은 모두 pi 내장 동작을 그대로 쓴다.
// 전제: settings.json 의 cacheWarming 이 "idle" 이어야 한다. ("off" 면 워밍 run 자체가 만들어지지 않아 /warm 이 동작하지 않는다.)
// 주의: 이 확장이 로드되지 않거나 핸들러가 실패하면 pi 내장 판단으로 되돌아가 자동 워밍이 일어날 수 있다.
// 제약: stop 은 다음 실제 요청 전까지 되돌릴 수 없으므로, 마지막 요청 후 첫 판단 전에 켜야 효과가 있다.
const STATUS_KEY = "cache-warm";

export default function (pi: ExtensionAPI) {
	let active = false;
	let count = 0;

	const stop = (ctx: ExtensionContext) => {
		active = false;
		count = 0;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	};

	pi.registerCommand("warm", {
		description: "Keep the prompt cache warm until the next message (built-in idle warmer)",
		handler: async (_args, ctx) => {
			active = true;
			count = 0;
			ctx.ui.setStatus(STATUS_KEY, "warm: on");
			ctx.ui.notify("캐시 워밍 켜짐 (다음 메시지 전까지, 최대 30분)", "info");
		},
	});

	pi.on("cache_warming_decision", (_event, ctx) => {
		if (!active) return { action: "stop" };
		count++;
		ctx.ui.setStatus(STATUS_KEY, `warm: ${count}`);
		return { action: "warm" };
	});

	// 슬래시 명령은 "다음 메시지"로 보지 않는다.
	pi.on("input", (event, ctx) => {
		if (active && !event.text.trimStart().startsWith("/")) stop(ctx);
	});

	pi.on("session_start", (_event, ctx) => stop(ctx));
	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}
