// Loaded only into children (via -e). When pi settles, meaning it will not
// continue on its own, this writes the last assistant message of the last run
// to $NOFS_HC_RESULT. The parent waits for that file.
import { renameSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ChildResult = { text: string; error?: string };

export default function (pi: ExtensionAPI) {
	const out = process.env.NOFS_HC_RESULT;
	if (!out) return;

	let last: ChildResult = { text: "" };

	pi.on("agent_end", (event) => {
		const reply = event.messages.findLast((m: any) => m?.role === "assistant") as any;
		if (!reply) return;
		const text = (reply.content ?? [])
			.filter((part: any) => part.type === "text")
			.map((part: any) => part.text)
			.join("\n")
			.trim();
		last = { text, error: reply.errorMessage };
	});

	pi.on("agent_settled", (event) => {
		const result: ChildResult = { text: last.text, error: last.error ?? (event.aborted ? "aborted" : undefined) };
		// Write then rename, so the parent never reads a half-written file.
		writeFileSync(`${out}.tmp`, JSON.stringify(result));
		renameSync(`${out}.tmp`, out);
		last = { text: "" };
	});
}
