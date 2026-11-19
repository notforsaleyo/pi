// nofs-hc-subagent: the `subagent` tool. Project agents (<cwd>/.pi/agents/*.md)
// run as interactive pi children in herdr terminals under this one. The tool
// waits for each child's final reply, returns it, and removes the terminal.
// See README.md.
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { scanAgents, type AgentScan } from "./agents.ts";
import { childCommand, type Command } from "./command.ts";
import { loadConfig, type Config } from "./config.ts";
import { family, pickModel } from "./models.ts";
import { runChild, type Outcome } from "./run.ts";

type Call = { agent: string; task: string; model?: string; thinking?: string };
type Job = { label: string; name: string; command: Command };

export default function (pi: ExtensionAPI) {
	// Children never get this tool: one level of subagents only.
	if (Number(process.env.PI_SUBAGENT_DEPTH) > 0) return;
	const parent = process.env.HC_TERMINAL_ID;
	if (!parent) return;

	pi.on("session_start", (_event, ctx) => {
		const scan = scanAgents(ctx.cwd);
		if (!scan) return;

		pi.registerTool({
			name: "subagent",
			label: "Subagent",
			description: describe(loadConfig(), scan, ctx.modelRegistry.getAvailable().map(modelId)),
			promptSnippet: "Delegate self-contained tasks to project agents running in herdr terminals; returns their final replies.",
			parameters: Type.Object({
				calls: Type.Array(
					Type.Object({
						agent: Type.String({ description: "Agent name" }),
						task: Type.String({ description: "Complete, self-contained task" }),
						model: Type.Optional(Type.String({ description: 'Model, exact or loose ("opus", "gpt 6.1"); the newest match is used' })),
						thinking: Type.Optional(Type.String({ description: 'Thinking level, e.g. "high"' })),
					}),
					{ minItems: 1, maxItems: 8 },
				),
			}),
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				// Re-read so edits to config.json or agent files apply without /reload.
				const config = loadConfig();
				const scan = scanAgents(ctx.cwd) ?? { agents: new Map(), skipped: [] };
				// Check every entry before starting any.
				const jobs = params.calls.map((call) => prepare(call, ctx, scan, config));

				const lines = jobs.map((job) => `${job.label}: starting`);
				const outcomes = await Promise.all(
					jobs.map((job, i) =>
						runChild({
							name: job.name,
							cwd: ctx.cwd,
							command: job.command,
							parent,
							signal,
							onStatus(line) {
								lines[i] = `${job.label}: ${line}`;
								onUpdate?.({ content: [{ type: "text", text: lines.join("\n") }], details: {} });
							},
						}).catch((error): Outcome => ({ ok: false, text: signal?.aborted ? "aborted" : message(error) })),
					),
				);
				const text = jobs
					.map((job, i) => `## ${job.label}: ${outcomes[i].ok ? "done" : "failed"}\n\n${outcomes[i].text}`)
					.join("\n\n");
				return { content: [{ type: "text", text }], details: {} };
			},
		});
	});
}

/** Resolve one call entry to a ready command. Throws a message the parent can act on. */
function prepare(call: Call, ctx: ExtensionContext, scan: AgentScan, config: Config): Job {
	const agent = scan.agents.get(call.agent);
	if (!agent) throw new Error(`Unknown agent "${call.agent}". Available: ${[...scan.agents.keys()].join(", ") || "none"}`);
	try {
		const available = ctx.modelRegistry.getAvailable();
		const id = pickModel(available.map(modelId), call.model ?? agent.model);
		const model = available.find((m) => modelId(m) === id)!;
		const thinking = call.thinking ?? agent.thinking;
		const levels: string[] = getSupportedThinkingLevels(model);
		if (thinking && !levels.includes(thinking)) {
			throw new Error(`${id} does not take thinking "${thinking}"; use one of: ${levels.join(", ")}`);
		}
		return {
			label: `${agent.name} (${id}${thinking ? `, ${thinking}` : ""})`,
			name: `${agent.name}-${family(id)}`,
			command: childCommand({ agent, task: call.task, cwd: ctx.cwd, model: id, thinking }, config, getAgentDir()),
		};
	} catch (error) {
		throw new Error(`${agent.name}: ${message(error)}`);
	}
}

function modelId(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function describe(config: Config, scan: AgentScan, models: string[]): string {
	const agents = [...scan.agents.values()].map(
		(a) => `- ${a.name}: ${a.model}${a.thinking ? `, thinking ${a.thinking}` : ""}${a.description ? `. ${a.description}` : ""}`,
	);
	return [
		"Run project agents as pi in herdr terminals under this one and wait for their final replies. The user can watch or steer them in herdr.",
		"Entries in `calls` run in parallel, each in its own terminal. A child sees only its task (plus documents its definition names), not this conversation, so make each task complete and self-contained.",
		`Write every task in ${config.promptLanguage}.`,
		'`model` and `thinking` override the agent\'s defaults. When the user names a model loosely, e.g. "opus high", pass model "opus" and thinking "high"; the newest available matching model is used.',
		'The user may name models and thinking levels in any language, transliterated or misspelled ("하이쿠 하이", "소냇 미듐", "테라 낮게"). Pass them as the English words of the matching model below ("haiku", "sonnet", "terra") and an English thinking level ("high", "medium", "low").',
		"",
		`Available models: ${models.join(", ")}`,
		"",
		"Agents (default model, thinking):",
		...(agents.length ? agents : ["- none"]),
		...(scan.skipped.length ? ["", "Unusable definitions:", ...scan.skipped.map((s) => `- ${s}`)] : []),
	].join("\n");
}
