import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const packageDir = process.env.PI_TEST_PACKAGE;

test("input box preserves the installed SDK's rendering and mouse behavior", { skip: !packageDir }, async (t) => {
  const sdk = await import(pathToFileURL(join(packageDir!, "dist/index.js")).href);
  const tui = await import(pathToFileURL(join(packageDir!, "node_modules/@earendil-works/pi-tui/dist/index.js")).href);
  const theme = await import(pathToFileURL(join(packageDir!, "dist/modes/interactive/theme/theme.js")).href);
  sdk.initTheme("dark", false);
  const { KeybindingsManager } = await import(pathToFileURL(join(packageDir!, "dist/core/keybindings.js")).href);
  const keybindings = new KeybindingsManager({});
  const previousKeybindings = tui.getKeybindings();
  tui.setKeybindings(keybindings);
  const proto = sdk.UserMessageComponent.prototype;
  const originalRender = Object.getOwnPropertyDescriptor(proto, "render")!;
  const marker = Symbol.for("pi.inputBox.userMessageRender");
  const originalMarker = Object.getOwnPropertyDescriptor(proto, marker);
  const globals = ["__piInputBox", "__piCacheTimerAt", "__piCacheDisplayTimer", "__piWorkingTimer", "__piAgentMode", "__piWarm", "__piAutoHandoff"];
  const saved = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  let emit: (name: string) => Promise<void> = async () => {};
  t.after(async () => {
    await emit("session_shutdown");
    Object.defineProperty(proto, "render", originalRender);
    if (originalMarker) Object.defineProperty(proto, marker, originalMarker); else delete proto[marker];
    globals.forEach((key, i) => {
      if (saved[i]) Object.defineProperty(globalThis, key, saved[i]!);
      else delete (globalThis as any)[key];
    });
    tui.setKeybindings(previousKeybindings);
  });

  const { loadExtensions } = await import(pathToFileURL(join(packageDir!, "dist/core/extensions/loader.js")).href);
  const loaded = await loadExtensions([fileURLToPath(new URL("./input-box.ts", import.meta.url))], fileURLToPath(new URL(".", import.meta.url)));
  assert.deepEqual(loaded.errors, []);
  loaded.runtime.getThinkingLevel = () => "high";
  const terminal = { terminal: { rows: 40, columns: 80 }, requestRender() {} };
  let editor: any;
  const ctx = {
    hasUI: true, mode: "tui", isIdle: () => true, model: { provider: "openai-codex", id: "test" },
    getContextUsage: () => ({ percent: 10 }),
    ui: {
      setWidget() {}, setWorkingIndicator() {}, theme: { fg: (_: string, s: string) => s },
      setEditorComponent(factory: Function) { editor = factory(terminal, theme.getEditorTheme(), keybindings); },
    },
  };
  emit = async (name) => {
    for (const handler of loaded.extensions[0].handlers.get(name) ?? []) await handler({}, ctx);
  };
  (globalThis as any).__piAgentMode = { label: "BASH", icon: "", rgb: [224, 108, 117], style: (s: string) => s };
  await emit("session_start");
  const fits = (lines: string[], width: number) => {
    for (const line of lines) assert(tui.visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
  };
  const mouse = (type: string, x: number, y: number, width = 80) => editor.handleMouse({
    type, button: "left", x, y, screenX: x, screenY: y, width, height: editor.render(width).length,
    shift: false, alt: false, ctrl: false,
  });

  await t.test("all rows fit narrow and wide terminals; Markdown and OSC markers survive", () => {
    for (const width of [11, 12, 17, 24, 40, 80]) {
      editor.setText("한글 wide text\nsecond line");
      fits(editor.render(width), width);
      const message = new sdk.UserMessageComponent("**bold**\n\n`code`\n\n[link](https://example.com)", undefined, 0);
      const lines = message.render(width);
      fits(lines, width);
      const raw = lines.join("\n");
      for (const zone of ["A", "B", "C"]) assert.equal(raw.split(`\x1b]133;${zone}\x07`).length - 1, 1);
      if (width >= 40) {
        assert(!tui.stripTerminalSequences(raw).includes("**bold**"));
        assert(raw.includes("\x1b[1m"), "Markdown bold must be styled");
      }
    }
  });

  await t.test("registered Markdown transformers still run", () => {
    const message = new sdk.UserMessageComponent("before", undefined, 0, [
      (text: string, context: any) => {
        assert.equal(context.messageType, "user");
        return text.replace("before", "**TRANSFORMED**");
      },
    ]);
    const rendered = tui.stripTerminalSequences(message.render(80).join("\n"));
    assert(rendered.includes("TRANSFORMED"));
    assert(!rendered.includes("before"));
    assert(!rendered.includes("**TRANSFORMED**"));
  });

  await t.test("body clicks map to the displayed line, decorations do not edit", () => {
    editor.setText("alpha\nbravo\n한글");
    editor.render(80);
    mouse("click", 2, 2);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
    mouse("click", 3, 3);
    assert.deepEqual(editor.getCursor(), { line: 1, col: 3 });
    mouse("click", 2, 4);
    assert.deepEqual(editor.getCursor(), { line: 2, col: 1 });
    for (const y of [0, 1, 5, 6, 7]) {
      mouse("click", 0, y);
      assert.deepEqual(editor.getCursor(), { line: 2, col: 1 });
    }
    assert.equal(mouse("drag", 2, 2), undefined);
    editor.setText("abc");
    editor.render(11);
    mouse("click", 1, 1, 11);
    assert.deepEqual(editor.getCursor(), { line: 0, col: 1 });
  });

  await t.test("wrapped and scrolled body uses the base editor's visual rows", () => {
    const plain = new sdk.CustomEditor(terminal, theme.getEditorTheme(), keybindings, { paddingX: 0 });
    const value = Array.from({ length: 20 }, (_, i) => `row${i} 한글 abcdefghijklmnop`).join("\n");
    for (const width of [12, 24, 80]) {
      editor.setText(value); plain.setText(value);
      editor.render(width); plain.render(width - 1);
      const rows = (plain as any).renderedVisibleLineCount;
      for (const y of [1, rows]) {
        mouse("click", 2, y + 1, width);
        plain.handleMouse({ type: "click", button: "left", x: 2, y, width: width - 1 });
        assert.deepEqual(editor.getCursor(), plain.getCursor());
      }
    }
  });

  await t.test("autocomplete fits and mouse clicks select the displayed item", async () => {
    editor.setAutocompleteProvider(new tui.CombinedAutocompleteProvider([
      { name: "alpha", description: "first" }, { name: "beta", description: "second" },
    ], process.cwd()));
    for (const width of [12, 24, 80]) {
      editor.setText("");
      editor.handleInput("/");
      await editor.autocompleteRequestTask;
      const lines = editor.render(width);
      fits(lines, width);
      assert(editor.renderedAutocompleteHeight >= 2);
      const y = editor.renderedVisibleLineCount + 5 + 1;
      mouse("press", 2, y, width);
      mouse("click", 2, y, width);
      assert.equal(editor.getText().trim(), "/beta");
    }
  });
});
