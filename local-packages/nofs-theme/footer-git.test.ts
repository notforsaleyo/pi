import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { stripTypeScriptTypes, syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import vm from "node:vm";
import { gitLabel, parseGitStatus, watchGitStatus } from "./footer-git.ts";

const porcelain = (extra = "", ahead = 0, behind = 0) =>
	`# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +${ahead} -${behind}\0${extra}`;

test("porcelain parsing and exact label spacing", () => {
	const clean = parseGitStatus(porcelain());
	assert.deepEqual(clean, { branch: "main", dirty: false, ahead: 0, behind: 0 });
	assert.equal(gitLabel(clean), "main");
	for (const record of ["1 .M file", "1 M. file", "u UU file", "? new file"])
		assert.equal(gitLabel(parseGitStatus(porcelain(record + "\0"))), "main *");
	assert.equal(gitLabel(parseGitStatus(porcelain("", 2))), "main↑ 2");
	assert.equal(gitLabel(parseGitStatus(porcelain("1 .M file\0", 2))), "main *↑ 2");
	assert.equal(gitLabel(parseGitStatus(porcelain("", 0, 1))), "main↓ 1");
	assert.equal(gitLabel(parseGitStatus(porcelain("1 .M file\0", 2, 1))), "main *↑ 2 ↓ 1");
	assert.equal(parseGitStatus("# branch.head (detached)\0").branch, "detached");
	assert.equal(parseGitStatus("# branch.oid (initial)\0# branch.head main\0").branch, "main");
	// A rename's old filename can look like a status header, and filenames can contain newlines.
	const rename = parseGitStatus(porcelain("2 R. new\nname\0# branch.ab +99 -99\0", 2));
	assert.equal(rename.ahead, 2);
	assert.equal(rename.behind, 0);
});

const settle = () => new Promise<void>((done) => setImmediate(done));

test("watcher batches changes, skips ignored files, limits queries and cleans up", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
	const root = resolve("test-repo");
	const gitDir = join(root, ".git");
	const watchers: Array<{ directory: string; event: (kind: string, name: string) => void; closed: boolean }> = [];
	const calls: string[][] = [];
	const states: unknown[] = [];
	let warnings = 0;
	let statusOutput = porcelain();
	let failStatus = false;
	t.mock.method(fs, "watch", (directory, _options, event) => {
		const record = { directory, event, closed: false };
		watchers.push(record);
		return Object.assign(new EventEmitter(), { unref() {}, close() { record.closed = true; } });
	});
	t.mock.method(childProcess, "execFile", (_file, args, _options, callback) => {
		calls.push(args);
		let input = "";
		queueMicrotask(() => {
			let output = "";
			let error: Error | null = null;
			if (args.includes("rev-parse")) output = [root, gitDir, gitDir].join("\n") + "\n";
			if (args.includes("status")) {
				output = statusOutput;
				if (failStatus) error = new Error("status failed");
			}
			if (args.includes("check-ignore")) output = input.split("\0").filter((p) => p.startsWith("sessions/")).join("\0") + "\0";
			callback(error, output);
		});
		return { stdin: { on() {}, end(value = "") { input = value; } } };
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const monitor = watchGitStatus(root, (value) => states.push(value), () => warnings++);
	t.after(() => monitor.dispose());
	await settle();
	const count = (command: string) => calls.filter((args) => args.includes(command)).length;
	const change = (path: string) => watchers[0]!.event("change", path);
	const advance = async (ms: number) => { t.mock.timers.tick(ms); await settle(); };
	assert.equal(count("status"), 1);
	assert.equal(watchers.length, 1);
	await advance(60_000);
	assert.equal(count("status"), 1, "No polling when idle");

	statusOutput = porcelain("1 .M file\0", 2);
	change("file");
	change("another-file");
	await advance(999);
	assert.equal(count("status"), 1);
	await advance(1);
	assert.equal(count("status"), 2, "One status for the burst");
	assert.equal(gitLabel(states.at(-1) as ReturnType<typeof parseGitStatus>), "main *↑ 2");

	change("file");
	await advance(4999);
	assert.equal(count("status"), 2, "Cooldown prevents repeated status queries");
	await advance(1);
	assert.equal(count("status"), 3);

	change("sessions/current.jsonl");
	await advance(5000);
	assert.equal(count("status"), 3, "Ignored logs do not run status");
	const beforeIgnored = calls.length;
	change("sessions/current.jsonl");
	change(".git/objects/ab/cd");
	change(".git/index.lock");
	await advance(60_000);
	assert.equal(calls.length, beforeIgnored, "Cached ignored events do not even spawn Git");

	statusOutput = porcelain("", 0, 1);
	change(".git/refs/remotes/origin/main");
	await advance(1000);
	assert.equal((states.at(-1) as ReturnType<typeof parseGitStatus>).behind, 1);
	failStatus = true;
	monitor.refresh();
	await advance(5000);
	assert.equal(states.at(-1), undefined, "Failure clears stale status");
	assert.equal(warnings, 0);
	monitor.refresh();
	monitor.dispose();
	const beforeDispose = calls.length;
	await advance(60_000);
	assert.equal(calls.length, beforeDispose);
	assert(watchers.every((watcher) => watcher.closed));
});

test("linked worktree metadata, continuous events, and disposal during a query", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
	const root = resolve("linked-worktree");
	const common = resolve("main-repo/.git");
	const gitDir = join(common, "worktrees", "linked");
	const watched = new Map<string, Function>();
	const states: unknown[] = [];
	let statusCalls = 0;
	let hold = false;
	let release: (() => void) | undefined;
	t.mock.method(fs, "watch", (directory, _options, event) => {
		watched.set(directory, event);
		return Object.assign(new EventEmitter(), { unref() {}, close() {} });
	});
	t.mock.method(childProcess, "execFile", (_file, args, _options, callback) => {
		const finish = () => {
			if (args.includes("rev-parse")) callback(null, [root, gitDir, common].join("\n"));
			else if (args.includes("check-ignore")) callback(Object.assign(new Error("not ignored"), { code: 1 }), "");
			else { statusCalls++; callback(null, porcelain("1 .M file\0")); }
		};
		if (hold) release = finish;
		else queueMicrotask(finish);
		return { stdin: { on() {}, end() {} } };
	});
	syncBuiltinESMExports();
	t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
	const monitor = watchGitStatus(root, (state) => states.push(state), () => assert.fail("watch failed"));
	t.after(() => monitor.dispose());
	await settle();
	assert(watched.has(root) && watched.has(gitDir) && watched.has(common));
	watched.get(gitDir)!("change", "index");
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(statusCalls, 2);
	watched.get(common)!("change", "refs/remotes/origin/main");
	t.mock.timers.tick(5000);
	await settle();
	assert.equal(statusCalls, 3);
	// A continuous stream of filesystem events still gets a bounded refresh.
	for (let i = 0; i < 10; i++) {
		watched.get(root)!("change", "file");
		t.mock.timers.tick(500);
		await settle();
	}
	assert.equal(statusCalls, 4);
	hold = true;
	monitor.refresh();
	t.mock.timers.tick(5000);
	await settle();
	const count = states.length;
	monitor.dispose();
	release!();
	await settle();
	assert.equal(states.length, count, "A disposed footer cannot receive a late result");
});

test("real Git and filesystem watcher detect an external file creation", async () => {
	const directory = fs.mkdtempSync(join(tmpdir(), "pi-footer-git-"));
	let monitor: ReturnType<typeof watchGitStatus> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		childProcess.execFileSync("git", ["init", "--initial-branch=main", directory], { stdio: "ignore", windowsHide: true });
		await new Promise<void>((done, fail) => {
			let initial = true;
			deadline = setTimeout(() => fail(new Error("File event did not refresh Git status")), 12_000);
			monitor = watchGitStatus(directory, (status) => {
				try {
					assert(status);
					assert.equal(status.branch, "main");
					if (initial) {
						assert.equal(status.dirty, false);
						initial = false;
						fs.writeFileSync(join(directory, "external.txt"), "created outside Pi");
					} else {
						assert.equal(status.dirty, true);
						done();
					}
				} catch (error) { fail(error); }
			}, () => fail(new Error("Filesystem watch failed")));
		});
	} finally {
		clearTimeout(deadline);
		monitor?.dispose();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("footer renders context chip and existing cache ratios, with requested Git colors", () => {
	// Execute the extension against a small UI host, without loading Pi or touching the user's session.
	const source = stripTypeScriptTypes(fs.readFileSync(new URL("./footer.ts", import.meta.url), "utf8"))
		.replace(/^import[^;]+;\r?$/gm, "")
		.replace(/export default function\s*\(pi\s*\)/, "function install(pi)");
	const colors = { BLUE: [30, 100, 220], GREEN: [56, 150, 60], RED: [220, 0, 0], YELLOW: [190, 140, 0] };
	const colored: Array<{ color: number[]; text: string }> = [];
	let gitChanged: (status: unknown) => void;
	const sandbox = {
		...colors, basename: () => "repo", gitLabel,
		fg(color: number[], text: string) { colored.push({ color, text }); return text; },
		visibleWidth: (text: string) => text.length,
		truncateToWidth: (text: string, width: number) => text.slice(0, width),
		watchGitStatus(_cwd: string, changed: typeof gitChanged) { gitChanged = changed; return { refresh() {}, dispose() {} }; },
	};
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox);
	const handlers = new Map();
	let component: { render(width: number): string[]; dispose(): void };
	let context: { tokens: number | null; contextWindow: number } | undefined = { tokens: 32100, contextWindow: 200000 };
	const theme = { fg: (_color: string, text: string) => text };
	const ctx = {
		hasUI: true, cwd: "repo", model: { id: "must-not-appear", contextWindow: 200000 },
		getContextUsage: () => context,
		sessionManager: {
			getLeafId: () => "leaf",
			getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 10, output: 999, cacheRead: 90, cacheWrite: 0 } } }],
		},
		ui: { setFooter(factory: Function) {
			component = factory({ requestRender() {} }, theme, { getGitBranch: () => "main", onBranchChange: () => () => {} });
		}, notify() {} },
	};
	(sandbox as any).install({ on: (name: string, fn: Function) => handlers.set(name, fn), getSessionName: () => "test-session" });
	handlers.get("session_start")({}, ctx);
	for (const [dirty, behind, color] of [[false, 0, colors.BLUE], [true, 0, colors.YELLOW], [false, 1, colors.RED], [true, 1, colors.RED]] as const) {
		gitChanged!({ branch: "main", dirty, ahead: 2, behind });
		colored.length = 0;
		const line = component!.render(200)[0]!;
		assert(line.includes("\uf2db 32.1k/200.0k"));
		assert.equal(line.match(/90\.0%/g)?.length, 2);
		assert(!line.includes("must-not-appear") && !line.includes("999"));
		assert.deepEqual(colored[0]!.color, color);
	}
	context = { tokens: null, contextWindow: 200000 };
	assert(component!.render(200)[0]!.includes("\uf2db --/200.0k"));
	context = undefined;
	assert(component!.render(200)[0]!.includes("\uf2db --/200.0k"));
	gitChanged!(null);
	assert(component!.render(200)[0]!.includes("no git"));
	gitChanged!(undefined);
	assert(component!.render(200)[0]!.includes("main ?"));
	for (const width of [10, 40, 80, 200]) assert(component!.render(width)[0]!.length <= width);
	component!.dispose();
});
