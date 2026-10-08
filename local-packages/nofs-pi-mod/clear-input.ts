import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Shift+Del: 입력창 전부 지우기
export default function (pi: ExtensionAPI) {
	pi.registerShortcut("shift+delete", {
		description: "Clear the input editor",
		handler: async (ctx) => {
			ctx.ui.setEditorText("");
		},
	});
}
