import { unlinkSync, writeSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	let pendingFile: string | undefined;

	pi.on("session_shutdown", (event) => {
		const file = pendingFile;
		pendingFile = undefined;
		if (event.reason !== "quit" || !file) return;

		// session_shutdown의 뒤쪽 핸들러도 저장할 수 있으므로 실제 프로세스 종료 때 삭제한다.
		process.once("exit", () => {
			try {
				unlinkSync(file);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
					process.exitCode = 1;
					writeSync(2, `\n/purge: Failed to delete the session file: ${file}\n${String(error)}\n`);
					return;
				}
			}
			writeSync(2, `\n/purge: Session file deleted. The resume instructions above no longer apply.\n${file}\n`);
		});
	});

	pi.registerCommand("purge", {
		description: "Delete the current session permanently after confirmation, then quit Pi",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("사용법: /purge", "info");
				return;
			}
			if (!ctx.hasUI) return;
			if (!ctx.isIdle() || ctx.hasPendingMessages()) {
				ctx.ui.notify("진행 중인 작업과 대기 메시지를 완료하거나 취소한 뒤 /purge 를 실행하십시오.", "warning");
				return;
			}
			const file = ctx.sessionManager.getSessionFile();
			if (file && (!isAbsolute(file) || extname(file) !== ".jsonl")) {
				ctx.ui.notify("현재 세션 파일 경로를 확인할 수 없어 중단합니다.", "error");
				return;
			}
			const name = ctx.sessionManager.getSessionName() || "이름 없음";
			const confirmed = await ctx.ui.confirm("현재 세션 삭제 후 종료", `${name}\n${file ?? "저장되지 않은 세션"}\n현재 세션만 영구 삭제하고 Pi를 종료합니다. 복구할 수 없습니다.`);
			if (!confirmed) return;
			if (!ctx.isIdle() || ctx.hasPendingMessages() || ctx.sessionManager.getSessionFile() !== file) {
				ctx.ui.notify("확인 중 세션 상태가 변경되어 중단했습니다. /purge 를 다시 실행하십시오.", "warning");
				return;
			}
			pendingFile = file;
			ctx.shutdown();
		},
	});
}
