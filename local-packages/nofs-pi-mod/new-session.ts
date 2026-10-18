import { unlink } from "node:fs/promises";
import { sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// /fresh [--purge] [이름]: 빈 새 세션을 만들고 직전 이름은 모델에 전달하지 않는 UI 알림으로 표시한다.
// --purge 가 있으면 새 세션이 만들어진 뒤 이전 세션 파일을 바로 삭제한다 (확인 없음, 휴지통 없음).
export default function (pi: ExtensionAPI) {
	pi.registerCommand("fresh", {
		description: "Start a named new session (usage: /fresh [--purge] [new session name])",
		handler: async (args, ctx) => {
			let rest = args.trim();
			const purge = /^--purge(\s|$)/.test(rest);
			if (purge) rest = rest.slice("--purge".length).trim();
			const name = rest;
			if (!name) {
				ctx.ui.notify("사용법: /fresh [--purge] [새 세션 이름]", "info");
				return;
			}

			const previousName = ctx.sessionManager.getSessionName() || "이름 없음";
			// newSession 이후에는 ctx 가 이전 세션을 가리키지 않으므로 미리 저장한다.
			const oldFile = ctx.sessionManager.getSessionFile();
			if (purge && (!oldFile || !oldFile.includes(`${sep}sessions${sep}`))) {
				ctx.ui.notify("현재 세션 파일 경로를 확인할 수 없어 --purge 를 적용할 수 없습니다. 중단합니다.", "error");
				return;
			}

			await ctx.newSession({
				setup: async (sessionManager) => {
					sessionManager.appendSessionInfo(name);
				},
				withSession: async (newCtx) => {
					newCtx.ui.notify(`직전 세션: ${previousName}${purge ? " (삭제됨)" : ""}`, "info");
					if (purge && oldFile) {
						try {
							await unlink(oldFile);
						} catch (error) {
							newCtx.ui.notify(`이전 세션 삭제에 실패했습니다: ${(error as Error).message}`, "warning");
						}
					}
				},
			});
		},
	});
}
