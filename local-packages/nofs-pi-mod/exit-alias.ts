import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// /exit: /quit 의 alias
export default function (pi: ExtensionAPI) {
	pi.registerCommand("exit", {
		description: "Quit Pi (alias of /quit)",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}
