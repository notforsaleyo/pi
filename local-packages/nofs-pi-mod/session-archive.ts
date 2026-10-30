import { basename } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { pickSession, type SessionSelection } from "./session-archive-selector.ts";
import { archiveSessions, moveSession, type SessionArea } from "./session-archive-store.ts";

export default function (pi: ExtensionAPI) {
	let busy = false;
	const run = async (area: SessionArea, args: string, ctx: ExtensionCommandContext) => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("세션 보관 명령은 대화형 TUI에서만 사용할 수 있습니다.", "error");
			return;
		}
		if (args.trim()) {
			ctx.ui.notify(area === "sessions" ? "사용법: /archive" : "사용법: /show-archived", "info");
			return;
		}
		if (busy) return;
		busy = true;
		try {
			const agentDir = getAgentDir();
			let selected: SessionSelection | undefined;
			let target: string;
			try {
				selected = await pickSession(ctx, agentDir, area);
				if (!selected) return;
				if (area === "sessions") {
					const { moved, failed } = await archiveSessions(agentDir, selected.paths, ctx.sessionManager.getSessionFile());
					const details = failed.slice(0, 5).map(({ source, message }) => `${basename(source)}: ${message}`);
					if (failed.length > 5) details.push(`외 ${failed.length - 5}개. 실패한 세션은 /archive에서 다시 확인하십시오.`);
					ctx.ui.notify(failed.length
						? [`보관 ${moved}개 / 실패 ${failed.length}개`, ...details].join("\n")
						: `보관했습니다: ${moved}개 세션`, failed.length ? "warning" : "info");
					return;
				}
				// Only replacing the conversation waits; browsing and file moves do not.
				if (selected.resume) {
					if (!ctx.isIdle()) ctx.ui.notify("현재 작업이 끝나면 선택한 세션을 복원하고 재개합니다.", "info");
					await ctx.waitForIdle();
				}
				target = await moveSession(agentDir, selected.paths[0], area, ctx.sessionManager.getSessionFile());
				ctx.ui.notify(`복원했습니다: ${basename(target)}`, "info");
			} catch (error) {
				ctx.ui.notify(`세션 이동 실패: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			if (!selected.resume) return;

			// Replacement may invalidate ctx even on failure. Keep its error boundary
			// separate from file operations, and never roll back a restored active file.
			try {
				const result = await ctx.switchSession(target, {
					withSession: async (fresh) => {
						fresh.ui.notify("보관된 세션을 복원하고 재개했습니다.", "info");
					},
				});
				if (result.cancelled) ctx.ui.notify("재개는 취소되었습니다. 복원한 세션은 Ctrl+S에서 찾을 수 있습니다.", "info");
			} catch (error) {
				throw new Error(`복원은 완료했으나 재개하지 못했습니다. Ctrl+S에서 다시 여십시오: ${target}`, { cause: error });
			}
		} finally {
			busy = false;
		}
	};
	pi.registerCommand("archive", {
		description: "Archive sessions (Ctrl+Space: select; Ctrl+A: toggle all search results; Enter: archive)",
		handler: (args, ctx) => run("sessions", args, ctx),
	});
	pi.registerCommand("show-archived", {
		description: "Browse archived sessions (Enter: restore and resume; Ctrl+U: restore only)",
		handler: (args, ctx) => run("archived-sessions", args, ctx),
	});
}
