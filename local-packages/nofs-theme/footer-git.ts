import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";

export interface GitStatus {
	branch: string;
	dirty: boolean;
	ahead: number;
	behind: number;
}

export function parseGitStatus(output: string): GitStatus {
	const status: GitStatus = { branch: "detached", dirty: false, ahead: 0, behind: 0 };
	const records = output.split("\0");
	for (let i = 0; i < records.length; i++) {
		const record = records[i]!;
		if (record.startsWith("# branch.head ")) {
			const branch = record.slice(14);
			status.branch = branch === "(detached)" ? "detached" : branch;
		} else if (record.startsWith("# branch.ab ")) {
			const counts = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
			if (counts) [status.ahead, status.behind] = [Number(counts[1]), Number(counts[2])];
		} else if (/^(1|2|u|\?) /.test(record)) {
			status.dirty = true;
			if (record.startsWith("2 ")) i++; // The next NUL record is the rename's original path.
		}
	}
	return status;
}

export function gitLabel(status: GitStatus): string {
	return `${status.branch}${status.dirty ? " *" : ""}` +
		(status.ahead ? `↑ ${status.ahead}` : "") +
		(status.behind ? `${status.ahead ? " " : ""}↓ ${status.behind}` : "");
}

function git(cwd: string, args: string[], signal: AbortSignal, input?: string): Promise<string> {
	return new Promise((done, fail) => {
		const child = execFile("git", ["--no-optional-locks", ...args], {
			cwd, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024, signal,
		}, (error, stdout) => {
			if (error && !(args[0] === "check-ignore" && error.code === 1)) fail(error);
			else done(stdout);
		});
		child.stdin?.on("error", () => {}); // A failed/aborted Git process may close stdin early.
		child.stdin?.end(input);
	});
}

// Like VS Code: debounce filesystem events, serialize queries, and leave a cooldown after a query.
// No timer runs when there are no pending changes; ignored-file decisions are cached until Git rules change.
export function watchGitStatus(
	cwd: string,
	changed: (status: GitStatus | null | undefined) => void,
	watchError: () => void,
) {
	const abort = new AbortController();
	const watchers: FSWatcher[] = [];
	const pending = new Set<string>();
	const ignored = new Set<string>();
	let root: string | undefined;
	let gitDirs: string[] = [];
	let disposed = false;
	let running = false;
	let force = false;
	let warned = false;
	let lastFinished = 0;
	let queuedAt: number | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;

	function schedule() {
		if (disposed || running) return;
		if (timer) clearTimeout(timer);
		const now = Date.now();
		queuedAt ??= now;
		// Continuous output to ignored session logs must not postpone the first ignore check forever.
		const due = Math.max(lastFinished + 5000, Math.min(now + 1000, queuedAt + 5000));
		timer = setTimeout(() => void refresh(), Math.max(0, due - now));
		timer.unref?.();
	}

	function requestRefresh() {
		force = true;
		schedule();
	}

	function onChange(directory: string, filename: string | null) {
		if (disposed) return;
		if (!filename) { requestRefresh(); return; }
		const full = resolve(directory, filename);
		for (const gitDir of gitDirs) {
			const name = relative(gitDir, full).replaceAll("\\", "/");
			if (name === ".." || name.startsWith("../") || isAbsolute(name)) continue;
			if (name.endsWith(".lock")) return;
			if (/^(HEAD|index|config|packed-refs|shallow|info\/exclude|refs(?:\/.*)?|reftable(?:\/.*)?)$/.test(name)) {
				ignored.clear();
				requestRefresh();
			}
			return;
		}
		const name = relative(root!, full).replaceAll("\\", "/");
		if (basename(full) === ".gitignore" || name === ".git") {
			ignored.clear();
			requestRefresh();
		} else if (!ignored.has(name)) {
			pending.add(name);
			schedule();
		}
	}

	function attach(directory: string) {
		const failed = () => {
			if (!disposed && !warned) { warned = true; watchError(); }
		};
		try {
			const watcher = watch(directory, { recursive: true }, (_event, filename) => onChange(directory, filename));
			watcher.on("error", failed);
			watcher.unref();
			watchers.push(watcher);
		} catch { failed(); }
	}

	async function refresh() {
		timer = undefined;
		queuedAt = undefined;
		if (disposed || running) return;
		running = true;
		const forced = force;
		force = false;
		const paths = [...pending];
		pending.clear();
		try {
			if (!root) {
				let locations: string;
				try {
					locations = await git(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], abort.signal);
				} catch (error) {
					if (!disposed) {
						const notRepo = /not a git repository/i.test(String(error));
						changed(notRepo ? null : undefined);
					}
					return;
				}
				if (disposed) return;
				const [repo, gitDir, commonDir] = locations.trim().split(/\r?\n/);
				root = resolve(repo!);
				gitDirs = [...new Set([resolve(gitDir!), resolve(commonDir!)])];
				attach(root);
				for (const directory of gitDirs) {
					const name = relative(root, directory);
					if (name === ".." || name.startsWith("..\\") || name.startsWith("../") || isAbsolute(name)) attach(directory);
				}
			} else if (!forced && paths.length) {
				const excluded = await git(root, ["check-ignore", "--stdin", "-z"], abort.signal, paths.join("\0") + "\0");
				for (const name of excluded.split("\0")) if (name) ignored.add(name);
				if (paths.every((name) => ignored.has(name))) return;
			}
			const output = await git(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"], abort.signal);
			if (!disposed) changed(parseGitStatus(output));
		} catch {
			if (!disposed) changed(undefined); // Never show stale clean/ahead state after a failed query.
		} finally {
			running = false;
			lastFinished = Date.now();
			if (!disposed && (force || pending.size)) schedule();
		}
	}

	void refresh();
	return {
		refresh: requestRefresh,
		dispose() {
			disposed = true;
			if (timer) clearTimeout(timer);
			for (const watcher of watchers) watcher.close();
			abort.abort();
		},
	};
}
