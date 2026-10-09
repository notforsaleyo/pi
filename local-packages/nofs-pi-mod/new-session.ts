import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// /fresh [이름]: 빈 새 세션을 만들고 직전 이름은 모델에 전달하지 않는 UI 알림으로 표시한다.
export default function (pi: ExtensionAPI) {
	pi.registerCommand("fresh", {
		description: "Start a named new session (usage: /fresh [new session name])",
		handler: async (args, ctx) => {
			const name = args.trim();
			if (!name) {
				ctx.ui.notify("사용법: /fresh [새 세션 이름]", "info");
				return;
			}

			const previousName = ctx.sessionManager.getSessionName() || "이름 없음";
			await ctx.newSession({
				setup: async (sessionManager) => {
					sessionManager.appendSessionInfo(name);
				},
				withSession: async (newCtx) => {
					newCtx.ui.notify(`직전 세션: ${previousName}`, "info");
				},
			});
		},
	});
}
