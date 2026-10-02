import { basename } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { thinkingLabel } from "./input-box.ts";

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

const rgb = (c: [number, number, number], s: string) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[39m`;
const BLUE: [number, number, number] = [30, 100, 220];
const GREEN: [number, number, number] = [56, 150, 60];
const YELLOW: [number, number, number] = [190, 140, 0];
const RED: [number, number, number] = [220, 0, 0];

const fmt = (n: number) => (n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(2)}M`);

export default function (pi: ExtensionAPI) {
  // Loaded as a local package listed after npm:@sreetej510/pi-usage in settings.json "packages",
  // so this session_start handler runs after pi-usage's and its setFooter call wins.
  pi.on("session_start", (_e, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        // pi/ctx go stale after reload or session replacement; never throw from render.
        render(width: number): string[] {
          try {
            return this.build(width);
          } catch {
            return [""];
          }
        },
        build(width: number): string[] {
          let input = 0;
          let output = 0;
          let cacheRead = 0;
          let cacheWrite = 0;
          for (const e of ctx.sessionManager.getBranch()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const u = (e.message as AssistantMessage).usage;
              input += u.input;
              output += u.output;
              cacheRead += u.cacheRead;
              cacheWrite += u.cacheWrite;
            }
          }

          // left: folder - session name
          const folder = basename(ctx.cwd ?? process.cwd()) || "/";
          const name = pi.getSessionName();
          const left =
            theme.fg("accent", `${ICON.folder} ${folder}`) +
            theme.fg("dim", " - ") +
            (name ? theme.fg("text", name) : ANON);

          // middle: git branch
          const branch = footerData.getGitBranch();
          const mid = branch
            ? theme.fg("success", `${ICON.branch} ${branch}`)
            : theme.fg("dim", `${ICON.noGit} no git`);

          // right: model - effort - tokens - CH
          const total = input + cacheRead + cacheWrite;
          const ratio = total > 0 ? (cacheRead / total) * 100 : undefined;
          const ratioText = `${ICON.cache} ${ratio === undefined ? "--" : `${ratio.toFixed(1)}%`}`;
          const ratioStyled =
            ratio === undefined
              ? theme.fg("dim", ratioText)
              : rgb(ratio >= 95 ? BLUE : ratio >= 90 ? GREEN : ratio >= 80 ? YELLOW : RED, ratioText);
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
        },
      };
    });
  });
}
