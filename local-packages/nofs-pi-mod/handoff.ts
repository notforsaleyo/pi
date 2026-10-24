import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// /handoff [--purge] [--force] [작업]: 현재 세션(따뜻한 캐시)에 핸드오프 노트를 쓰게 하고, <cwd>/.pi/handoff.md 에 저장한 뒤
//   새 세션을 시작한다. 새 세션의 입력창에는 /handover 가 채워져 있다.
//   UI 가 있으면 노트 작성 전에 요약 중점을 묻는다 (작성 안 함 / 직접 작성). Esc 는 핸드오프 전체를 취소한다.
//   요약 중점은 노트를 쓰는 현재 세션에만 전달되고 handoff.md 에는 저장하지 않는다.
//   작업은 노트 작성 요청과 handoff.md 의 ## Task 양쪽에 들어간다.
//   handoff.md 가 이미 있으면 경고만 하고 중단한다. --force 가 있으면 확인 없이 덮어쓴다.
//   --purge 가 있으면 새 세션이 만들어진 뒤 현재 세션 파일을 바로 삭제한다 (확인 없음, 휴지통 없음).
// /handover: handoff.md 를 읽어 메시지로 전송하고 파일을 삭제한다.
//   삭제는 전송이 시작된 뒤에만 한다.
// 프롬프트 지시문과 전체 흐름은 default-anton/pi-handoff (Apache-2.0) 를 참고했다.

const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_MS = 100;
const SEND_GRACE_MS = 1500;

const handoffPath = (cwd: string) => join(cwd, ".pi", "handoff.md");
const exists = (p: string) => access(p).then(() => true, () => false);

const INSTRUCTIONS = `You are writing a handoff note for another AI agent with NO access to this chat.

Extract only the context needed to continue the work from this conversation.

Rules:
- Be tight and token-efficient.
- Use only concrete facts from this conversation.
- Prefer specifics: file paths, symbols, commands, errors, outputs, decisions.
- Include constraints/invariants only when explicit, non-negotiable, and relevant.
- Include line numbers only if known from this conversation.
- Omit irrelevant history and broad retrospectives.
- Do not invent missing details.
- If a critical detail is unknown, say so briefly and include the smallest verification step.
- Do not write a plan unless one already exists in this conversation.
- Do not call tools.
- The next agent starts with the same system prompt, project instructions (AGENTS.md and similar), skills list, and tool definitions. Do NOT repeat or summarize any of that: no response-style rules, no commit rules, no mode descriptions, no tool lists.
- Write the note in English, regardless of the language used in this conversation. Keep file paths, identifiers, and quoted error messages verbatim.

Output:
- Markdown only.
- Handoff context only (do not restate the task).`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function messageText(entry: SessionEntry): string {
	if (entry.type !== "message") return "";
	const content = (entry.message as any).content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((b: any) => b?.type === "text" && typeof b.text === "string")
		.map((b: any) => b.text)
		.join("\n")
		.trim();
}

// 요청 user 메시지 이후에 끝까지 응답한 assistant 메시지의 텍스트를 찾는다.
function findNote(branch: SessionEntry[], from: number, request: string): string | null | undefined {
	let requestAt = -1;
	for (let i = branch.length - 1; i >= from; i--) {
		const e = branch[i]!;
		if (e.type === "message" && (e.message as any).role === "user" && messageText(e).startsWith(request.slice(0, 200))) {
			requestAt = i;
			break;
		}
	}
	if (requestAt === -1) return undefined; // 아직 요청이 세션에 기록되지 않음
	for (let i = branch.length - 1; i > requestAt; i--) {
		const e = branch[i]!;
		if (e.type !== "message" || (e.message as any).role !== "assistant") continue;
		if ((e.message as any).stopReason !== "stop") return null;
		const text = messageText(e);
		return text || null;
	}
	return undefined; // 아직 응답 없음
}

async function waitForNote(ctx: ExtensionCommandContext, from: number, request: string): Promise<string | null> {
	const deadline = Date.now() + TIMEOUT_MS;
	while (Date.now() < deadline) {
		await ctx.waitForIdle();
		const note = findNote(ctx.sessionManager.getBranch(), from, request);
		if (note !== undefined) return note;
		await sleep(POLL_MS); // 요청이 큐에 있고 아직 실행이 시작되지 않은 경우
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("handoff", {
		description: "Save a handoff note to .pi/handoff.md and move to a new session (usage: /handoff [--purge] [--force] [task for next session])",
		handler: async (args, ctx) => {
			const notify = (message: string, level: "info" | "warning" | "error") => ctx.ui.notify(message, level);

			let rest = args.trim();
			let purge = false;
			let force = false;
			for (;;) {
				const m = /^(--purge|--force)(\s+|$)/.exec(rest);
				if (!m) break;
				if (m[1] === "--purge") purge = true;
				else force = true;
				rest = rest.slice(m[0].length);
			}
			const task = rest.trim();

			const file = handoffPath(ctx.cwd);
			if (!force && (await exists(file))) {
				notify(`${file} 이(가) 이미 있습니다. 아직 /handover 로 소비되지 않은 핸드오프일 수 있어 중단합니다. 덮어쓰려면 /handoff --force 를 사용하십시오.`, "warning");
				return;
			}

			if (!ctx.model) {
				notify("모델이 선택되어 있지 않습니다.", "error");
				return;
			}

			// newSession 이후에는 ctx 가 이전 세션을 가리키지 않으므로 미리 저장한다.
			const oldFile = ctx.sessionManager.getSessionFile();
			if (purge && (!oldFile || !oldFile.includes(`${sep}sessions${sep}`))) {
				notify("현재 세션 파일 경로를 확인할 수 없어 --purge 를 적용할 수 없습니다. 중단합니다.", "error");
				return;
			}

			// 요약 중점: 현재 세션의 노트 작성에만 쓰고 다음 세션에는 전달하지 않는다.
			let focus = "";
			if (ctx.hasUI) {
				const NONE = "작성 안 함";
				const WRITE = "직접 작성";
				const choice = await ctx.ui.select("요약 중점 (노트 작성에만 쓰이고 다음 세션에는 전달되지 않습니다)", [NONE, WRITE]);
				if (choice === undefined) {
					notify("핸드오프를 취소했습니다.", "info");
					return;
				}
				if (choice === WRITE) {
					const text = await ctx.ui.editor("요약 중점을 입력하십시오:", "");
					if (text === undefined) {
						notify("핸드오프를 취소했습니다.", "info");
						return;
					}
					focus = text.trim();
				}
			}

			let request = INSTRUCTIONS;
			if (focus) request += `\n\nFocus for this note:\n${focus}`;
			if (task) request += `\n\nTask for the next agent:\n${task}`;
			const from = ctx.sessionManager.getBranch().length;

			pi.sendUserMessage(request, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
			notify("핸드오프 노트를 만드는 중...", "info");

			const note = await waitForNote(ctx, from, request);
			if (!note) {
				notify("핸드오프 노트를 받지 못했습니다. 현재 세션은 그대로 둡니다.", "error");
				return;
			}

			const content = task ? `${note}\n\n---\n\n## Task\n${task}` : note;

			try {
				await mkdir(dirname(file), { recursive: true });
				await writeFile(file, content, "utf8");
			} catch (error) {
				notify(`handoff.md 저장에 실패했습니다: ${(error as Error).message}. 현재 세션은 그대로 둡니다.`, "error");
				return;
			}

			const result = await ctx.newSession({
				withSession: async (newCtx) => {
					newCtx.ui.setEditorText("/handover");
					if (purge && oldFile) {
						try {
							await unlink(oldFile);
						} catch (error) {
							newCtx.ui.notify(`이전 세션 삭제에 실패했습니다: ${(error as Error).message}`, "warning");
						}
					}
					newCtx.ui.notify(`핸드오프를 ${file} 에 저장했습니다. Enter 로 /handover 를 실행하십시오.`, "info");
				},
			});

			if (result.cancelled) {
				notify(`새 세션 생성이 취소되어 현재 세션을 그대로 둡니다. 노트는 ${file} 에 남아 있습니다.`, "info");
				return;
			}
		},
	});

	pi.registerCommand("handover", {
		description: "Load .pi/handoff.md as a message, then delete the file",
		handler: async (_args, ctx) => {
			const file = handoffPath(ctx.cwd);
			let text: string;
			try {
				text = (await readFile(file, "utf8")).trim();
			} catch {
				ctx.ui.notify(`${file} 이(가) 없습니다.`, "warning");
				return;
			}
			if (!text) {
				ctx.ui.notify(`${file} 이(가) 비어 있습니다.`, "warning");
				return;
			}
			const sent = pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
			// 전송이 오류 없이 시작됐다고 볼 수 있을 때까지 기다린 뒤 삭제한다.
			await Promise.race([sent, sleep(SEND_GRACE_MS)]);
			try {
				await unlink(file);
			} catch (error) {
				ctx.ui.notify(`handoff.md 삭제에 실패했습니다: ${(error as Error).message}`, "warning");
			}
			await sent;
		},
	});
}
