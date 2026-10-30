import { link, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type SessionArea = "sessions" | "archived-sessions";

export function samePath(left: string, right: string): boolean {
	const a = resolve(left);
	const b = resolve(right);
	return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Matches Pi's default cwd encoding, without creating a directory on reads. */
export function sessionDirectory(root: string, cwd: string): string {
	const folder = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(root, folder);
}

/** Only the standard <encoded-cwd>/<session>.jsonl layout is movable. */
export function counterpart(agentDir: string, source: string, from: SessionArea): string {
	const rel = relative(resolve(agentDir, from), resolve(source));
	const parts = rel.split(sep);
	if (
		isAbsolute(rel) || parts.length !== 2 || parts[0] === ".." ||
		!parts[0].startsWith("--") || !parts[0].endsWith("--") ||
		!parts[1].endsWith(".jsonl")
	) {
		throw new Error("기본 세션 폴더 안의 JSONL 파일만 이동할 수 있습니다.");
	}
	const to: SessionArea = from === "sessions" ? "archived-sessions" : "sessions";
	return join(agentDir, to, rel);
}

async function assertDirectory(path: string): Promise<void> {
	const info = await lstat(path);
	if (!info.isDirectory() || info.isSymbolicLink()) {
		throw new Error(`심볼릭 링크 또는 일반 폴더가 아닌 경로는 지원하지 않습니다: ${path}`);
	}
}

export async function sessionFolders(root: string): Promise<string[]> {
	try {
		await assertDirectory(root);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const entries = await readdir(root, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() &&
			entry.name.startsWith("--") && entry.name.endsWith("--"))
		.map((entry) => join(root, entry.name))
		.sort();
}

// link() refuses an existing destination atomically; rename() may overwrite it.
// Remove the source only after linking succeeds, rolling back on removal failure.
export async function moveSession(
	agentDir: string,
	source: string,
	from: SessionArea,
	activeFile?: string,
): Promise<string> {
	const target = counterpart(agentDir, source, from);
	if (activeFile && (samePath(source, activeFile) || samePath(target, activeFile))) {
		throw new Error("현재 열린 세션은 이동할 수 없습니다.");
	}

	const sourceRoot = join(agentDir, from);
	const targetRoot = dirname(dirname(target));
	await assertDirectory(sourceRoot);
	await assertDirectory(dirname(source));
	const before = await lstat(source);
	if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
		throw new Error("일반 단일 세션 파일만 이동할 수 있습니다. 링크 또는 중복 이동 상태를 확인하십시오.");
	}

	await mkdir(targetRoot, { recursive: true });
	await assertDirectory(targetRoot);
	await mkdir(dirname(target), { recursive: true });
	await assertDirectory(dirname(target));

	try {
		await link(source, target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(`대상 파일이 이미 있어 덮어쓰지 않았습니다: ${target}`, { cause: error });
		}
		throw error;
	}

	try {
		const after = await lstat(source);
		if (before.dev !== after.dev || before.ino !== after.ino ||
			before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
			throw new Error("이동 중 세션이 변경되었습니다. 다른 pi에서 닫은 뒤 다시 시도하십시오.");
		}
		await unlink(source);
	} catch (error) {
		try {
			await unlink(target);
		} catch (rollbackError) {
			throw new AggregateError([error, rollbackError],
				`이동을 완료하지 못했습니다. 두 경로를 확인하십시오: ${source} / ${target}`);
		}
		throw error;
	}
	return target;
}

/** Each file is independent: one collision must not discard the rest of a batch. */
export async function archiveSessions(agentDir: string, sources: readonly string[], activeFile?: string) {
	let moved = 0;
	const failed: { source: string; message: string }[] = [];
	for (const source of new Set(sources)) {
		try {
			await moveSession(agentDir, source, "sessions", activeFile);
			moved++;
		} catch (error) {
			failed.push({ source, message: error instanceof Error ? error.message : String(error) });
		}
	}
	return { moved, failed };
}

/** Remap parent paths for archived threaded display only; never edit the JSONL. */
export function archivedParentPath(agentDir: string, parent: string | undefined): string | undefined {
	if (!parent) return parent;
	try {
		return counterpart(agentDir, parent, "sessions");
	} catch {
		return parent;
	}
}
