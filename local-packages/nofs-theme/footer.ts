import { basename } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { BLUE, fg, GREEN, RED, thinkingLabel, YELLOW } from "./colors.ts";

// One-line footer:
//   <folder> - <session name>   <git branch>   <model> - <effort> - <tokens> - <cache ratio>
// Needs a Nerd Font for the icons.

const ICON = {
	folder: "\uf07b",
	up: "\ueaf4",
	down: "\ueaf3",
	branch: "\uf126",
	noGit: "\uf05e",
	model: "\uf4bc",
	cache: "\uf1c0",
};

const ANON = "\x1b[1;31;4m!! 익명의 세션 !!\x1b[22;24;39m";

const fmt = (n: number) => (n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`);

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export default function (pi: ExtensionAPI) {
	// Loaded as a local package listed after npm:@sreetej510/pi-usage in settings.json "packages",
	// so this session_start handler runs after pi-usage's and its setFooter call wins.
	pi.on("session_start", (_e, ctx) => {
		// input-box.ts redraws every 100ms for its animation, so only re-sum usage when the leaf changes.
		let cachedLeaf: string | null | undefined;
		let cached: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
		const usage = (sm: ExtensionContext["sessionManager"]): Usage => {
			const leaf = sm.getLeafId();
			if (leaf === cachedLeaf) return cached;
			const u: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
			for (const e of sm.getBranch()) {
				if (e.type === "message" && e.message.role === "assistant") {
					const m = (e.message as AssistantMessage).usage;
					u.input += m.input;
					u.output += m.output;
					u.cacheRead += m.cacheRead;
					u.cacheWrite += m.cacheWrite;
				}
			}
			cachedLeaf = leaf;
			cached = u;
			return u;
		};

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			const build = (width: number): string[] => {
				const { input, output, cacheRead, cacheWrite } = usage(ctx.sessionManager);

				// left: folder - session name
				const folder = basename(ctx.cwd ?? process.cwd()) || "/";
				const name = pi.getSessionName();
				const left =
					theme.fg("accent", `${ICON.folder} ${folder}`) + theme.fg("dim", " - ") + (name ? theme.fg("text", name) : ANON);

				// middle: git branch
				const branch = footerData.getGitBranch();
				const mid = branch ? theme.fg("success", `${ICON.branch} ${branch}`) : theme.fg("dim", `${ICON.noGit} no git`);

				// right: model - effort - tokens - cache ratio
				const total = input + cacheRead + cacheWrite;
				const ratio = total > 0 ? (cacheRead / total) * 100 : undefined;
				const ratioText = `${ICON.cache} ${ratio === undefined ? "--" : `${ratio.toFixed(1)}%`}`;
				const ratioStyled =
					ratio === undefined
						? theme.fg("dim", ratioText)
						: fg(ratio >= 95 ? BLUE : ratio >= 90 ? GREEN : ratio >= 80 ? YELLOW : RED, ratioText);
				const sep = theme.fg("dim", " - ");
				const right =
					theme.fg("text", `${ICON.model} ${ctx.model?.id ?? "no-model"}`) +
					sep +
					thinkingLabel(pi.getThinkingLevel()) +
					sep +
					theme.fg("dim", `${ICON.up} ${fmt(input)} ${ICON.down} ${fmt(output)}`) +
					sep +
					ratioStyled;

				const lw = visibleWidth(left);
				const mw = visibleWidth(mid);
				const rw = visibleWidth(right);

				// Full layout: left, centered middle, right (>=1 space on each side).
				const free = width - lw - mw - rw;
				if (free >= 2) {
					const g1 = Math.floor(free / 2);
					return [left + " ".repeat(g1) + mid + " ".repeat(free - g1) + right];
				}
				// Too narrow: drop the middle part.
				const gap = width - lw - rw;
				if (gap >= 1) return [left + " ".repeat(gap) + right];
				// Still too narrow: keep the right side, trim the left.
				const leftRoom = width - rw - 1;
				if (leftRoom >= 4) return [truncateToWidth(left, leftRoom) + " " + right];
				return [truncateToWidth(right, width)];
			};

			return {
				dispose: unsub,
				invalidate() {},
				// pi/ctx go stale after reload or session replacement; never throw from render.
				render(width: number): string[] {
					try {
						return build(width);
					} catch {
						return [""];
					}
				},
			};
		});
	});
}
