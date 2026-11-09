import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import purge from "./purge.ts";

const extensionUrl = new URL("./purge.ts", import.meta.url).href;

test("purge deletes only the confirmed session after shutdown writers finish", async (t) => {
	for (const scenario of ["delete", "missing", "cancel", "reload", "failure", "ephemeral"]) {
		await t.test(scenario, async (t) => {
			const dir = await mkdtemp(join(tmpdir(), "pi-purge-test-"));
			t.after(() => rm(dir, { recursive: true, force: true }));
			const file = join(dir, "current.jsonl");
			const other = join(dir, "other.jsonl");
			await writeFile(other, "keep other session");
			if (scenario === "failure") await mkdir(file);
			else if (!["missing", "ephemeral"].includes(scenario)) await writeFile(file, "original");
			const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
				import assert from "node:assert/strict";
				import { existsSync, writeFileSync } from "node:fs";
				import purge from ${JSON.stringify(extensionUrl)};
				const file = ${JSON.stringify(file)};
				const scenario = ${JSON.stringify(scenario)};
				let handler, shutdown;
				let requested = false;
				purge({
					on: (event, fn) => { assert.equal(event, "session_shutdown"); shutdown = fn; },
					registerCommand: (name, command) => { assert.equal(name, "purge"); handler = command.handler; },
				});
				await handler("", {
					hasUI: true, isIdle: () => true, hasPendingMessages: () => false,
					sessionManager: { getSessionFile: () => scenario === "ephemeral" ? undefined : file, getSessionName: () => "test" },
					ui: { confirm: async (_title, message) => { assert(message.includes("복구할 수 없습니다")); return scenario !== "cancel"; }, notify() {} },
					shutdown: () => {
						requested = true;
						shutdown({ reason: scenario === "reload" ? "reload" : "quit" });
						if (["delete", "reload"].includes(scenario)) {
							assert(existsSync(file), "must retain the file during shutdown");
							writeFileSync(file, "last shutdown writer");
						}
					},
				});
				assert.equal(requested, scenario !== "cancel");
				process.exit(0);
			`], { encoding: "utf8", timeout: 10_000 });
			assert.ifError(result.error);
			assert.equal(result.status, scenario === "failure" ? 1 : 0, result.stderr);
			assert.equal(existsSync(file), ["cancel", "reload", "failure"].includes(scenario));
			assert.equal(await readFile(other, "utf8"), "keep other session");
			if (scenario === "failure") assert.match(result.stderr, /Failed to delete the session file/);
			if (["delete", "missing"].includes(scenario)) {
				assert.match(result.stderr, /Session file deleted\. The resume instructions above no longer apply\./);
			}
			if (scenario === "cancel") assert.equal(await readFile(file, "utf8"), "original");
			if (scenario === "reload") assert.equal(await readFile(file, "utf8"), "last shutdown writer");
		});
	}
});

test("purge rejects unsafe states without scheduling deletion or shutdown", async () => {
	for (const scenario of ["args", "no-ui", "busy", "queued", "relative", "wrong-extension", "changed", "became-busy", "became-queued"]) {
		let handler: any;
		let confirmed = false;
		const notices: string[] = [];
		const file = join(tmpdir(), "current.jsonl");
		purge({
			on() {},
			registerCommand: (_name: string, command: any) => { handler = command.handler; },
		} as any);
		await handler(scenario === "args" ? "--force" : "", {
			hasUI: scenario !== "no-ui",
			isIdle: () => scenario !== "busy" && !(confirmed && scenario === "became-busy"),
			hasPendingMessages: () => scenario === "queued" || (confirmed && scenario === "became-queued"),
			sessionManager: {
				getSessionFile: () => scenario === "relative" ? "relative.jsonl"
					: scenario === "wrong-extension" ? join(tmpdir(), "project.ts")
					: confirmed && scenario === "changed" ? join(tmpdir(), "replacement.jsonl") : file,
				getSessionName: () => undefined,
			},
			ui: {
				confirm: async () => { confirmed = true; return true; },
				notify: (message: string) => notices.push(message),
			},
			shutdown: () => assert.fail(`must not shut down: ${scenario}`),
		});
		assert.equal(notices.length, scenario === "no-ui" ? 0 : 1, scenario);
	}
});
