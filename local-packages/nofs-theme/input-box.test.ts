import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { contextStep } from "./colors.ts";

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const columns = (text: string) => [...plain(text)].length;

test("input lower border shows handshake only when enabled, fits width and uses mode color", () => {
	const source = stripTypeScriptTypes(readFileSync(new URL("./input-box.ts", import.meta.url), "utf8"))
		.replace(/^import[^;]+;\r?$/gm, "")
		.replace(/import\.meta\.url/g, '"file:///test/input-box.ts"')
		.replace(/export default function\s*\(pi\s*\)/, "function install(pi)");
	const events = new Map<string, Function>();
	let editor: any;
	let renders = 0;
	let forwarded = 0;
	let thinking = "high";
	const sandbox: any = {
		getSupportedThinkingLevels: () => ["low", "high"],
		contextStep,
		CustomEditor: class {
			render() { return ["top", "input", "bottom"]; }
			handleInput() { forwarded++; }
		},
		UserMessageComponent: class { render() { return []; } },
		readFileSync: () => '{"cacheTimerSeconds":300,"cacheTimerWidth":20}',
		URL, process: { env: {} },
		setInterval: () => 1, clearInterval() {},
		setAnimationEnabled() {}, ANIM_MS: 100,
		bold: (s: string) => s, dim: (s: string) => s,
		fg: (rgb: number[], s: string) => `\x1b[38;2;${rgb.join(";")}m${s}\x1b[39m`,
		thinkingLabel: () => "high", rainbowLabel: (s: string) => s,
		visibleWidth: columns,
		truncateToWidth: (s: string, width: number) => [...s].slice(0, width).join(""),
		wrapTextWithAnsi: (s: string) => [s],
		RED: [220, 0, 0], ORANGE: [255, 128, 0],
		__piAgentMode: { label: "BASH", icon: "", rgb: [224, 108, 117], style: (s: string) => s },
	};
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox);
	sandbox.install({
		on: (name: string, fn: Function) => events.set(name, fn), registerCommand() {},
		getThinkingLevel: () => thinking, setThinkingLevel: (level: string) => { thinking = level; },
	});
	const ctx = {
		hasUI: true, isIdle: () => true,
		model: { provider: "openai-codex", id: "test", reasoning: true },
		getContextUsage: () => ({ percent: 10 }),
		ui: {
			setWidget() {}, setWorkingIndicator() {}, theme: { fg: (_: string, s: string) => s },
			setEditorComponent(factory: Function) {
				editor = factory({ requestRender: () => renders++ }, {}, { matches: (data: string) => data === "cycle" });
			},
		},
	};
	events.get("session_start")!({}, ctx);
	for (const width of [12, 40, 80, 160]) {
		for (const enabled of [false, true, false]) {
			sandbox.__piAutoHandoff = { enabled };
			const bottom: string = editor.render(width).at(-1);
			assert.equal(columns(bottom), width);
			assert.equal(plain(bottom).startsWith("── \u{F1218} "), enabled);
			if (!enabled) assert.equal(plain(bottom), "─".repeat(width));
			assert.match(bottom, /^\x1b\[38;2;224;108;117m/);
		}
	}
	sandbox.__piInputBox.requestRender();
	assert.equal(renders, 1);

	// Cycling uses the public setter, not the base handler that emits a status message.
	editor.handleInput("cycle");
	assert.equal(thinking, "low");
	editor.handleInput("cycle");
	assert.equal(thinking, "high");
	assert.equal(forwarded, 0);
	editor.handleInput("ordinary input");
	ctx.model.reasoning = false;
	editor.handleInput("cycle");
	assert.equal(forwarded, 2);

	events.get("session_shutdown")!();
});
