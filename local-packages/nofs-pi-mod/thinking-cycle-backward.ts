import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Ctrl+Shift+\ : 추론 강도 한 단계 낮추기 (맨 아래에서 누르면 맨 위로 순환)
export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+shift+\\", {
		description: "Cycle thinking level backward",
		handler: (ctx) => {
			const model = ctx.model;
			if (!model?.reasoning) {
				ctx.ui.notify("Current model does not support thinking", "warning");
				return;
			}
			const levels = getSupportedThinkingLevels(model);
			const index = levels.indexOf(pi.getThinkingLevel() as (typeof levels)[number]);
			const previous = levels[(index - 1 + levels.length) % levels.length];
			pi.setThinkingLevel(previous);
		},
	});
}
