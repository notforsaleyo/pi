import { existsSync } from "node:fs";
import { join } from "node:path";
import { SessionManager, SessionSelectorComponent, type ExtensionCommandContext, type SessionInfo } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { archivedParentPath, samePath, sessionDirectory, sessionFolders, type SessionArea } from "./session-archive-store.ts";

export type SessionSelection = { paths: string[]; resume: boolean };
type SessionsLoader = ConstructorParameters<typeof SessionSelectorComponent>[0];

// Pi 1.4.0 has no title/filter-result API. These instance-local fields are the
// only version-sensitive boundary; the built-in /resume remains untouched.
interface NativeHeader extends Component {
	scope: "current" | "all";
	sortMode: "threaded" | "recent" | "relevance";
	nameFilter: "all" | "named";
	loading: boolean;
}
interface NativeListLayout {
	filteredSessions: { session: SessionInfo }[];
	selectedIndex: number;
	maxVisible: number;
	searchInput: Component;
	confirmingDeletePath: string | null;
}

export async function pickSession(ctx: ExtensionCommandContext, agentDir: string, area: SessionArea) {
	const archived = area === "archived-sessions";
	const root = join(agentDir, area);
	const cwd = ctx.sessionManager.getCwd();
	const activeFile = ctx.sessionManager.getSessionFile();
	const projectDir = sessionDirectory(root, cwd);
	if (!samePath(ctx.sessionManager.getSessionDir(), sessionDirectory(join(agentDir, "sessions"), cwd))) {
		throw new Error("현재는 기본 sessions/<작업 폴더> 저장 구조만 지원합니다. 사용자 지정 sessionDir은 이동하지 않습니다.");
	}
	const sort = (sessions: SessionInfo[]) => sessions.sort((a, b) =>
		b.modified.getTime() - a.modified.getTime() || b.path.localeCompare(a.path));
	const loader = (all: boolean): SessionsLoader => async (progress, signal) => {
		signal?.throwIfAborted();
		const folders = (await sessionFolders(root)).filter((folder) => all || samePath(folder, projectDir));
		const sessions: SessionInfo[] = [];
		for (const folder of folders) {
			signal?.throwIfAborted();
			// listAll(customDir) reads one directory, not Pi's global session root.
			const found = all ? await SessionManager.listAll(folder, undefined, signal)
				: await SessionManager.list(cwd, folder, undefined, signal);
			for (const session of found) {
				if (activeFile && samePath(session.path, activeFile)) continue;
				sessions.push(archived
					? { ...session, parentSessionPath: archivedParentPath(agentDir, session.parentSessionPath) }
					: session);
			}
			progress?.(sessions.length, sessions.length, sort([...sessions]));
		}
		signal?.throwIfAborted();
		return sort(sessions);
	};

	return ctx.ui.custom<SessionSelection | undefined>((tui, theme, keybindings, done) => {
		let closed = false;
		let resume = archived;
		const checked = new Set<string>();
		const render = () => { if (!closed) tui.requestRender(); };
		const finish = (result?: SessionSelection) => {
			if (closed) return;
			closed = true;
			done(result);
		};
		const selector = new SessionSelectorComponent(
			loader(false), loader(true),
			(path) => finish({ paths: !archived && checked.size ? [...checked] : [path], resume }),
			() => finish(), () => finish(), render,
			{
				keybindings,
				renameSession: async (path, name) => {
					if (name?.trim()) SessionManager.open(path).appendSessionInfo(name.trim());
				},
			},
			activeFile,
		);
		const list = selector.getSessionList();
		const dispose = () => {
			closed = true;
			list.onCancel?.(); // Clears native load controllers and status timers.
		};
		const header = selector.children.find((child) =>
			"setScope" in child && "setLoading" in child) as NativeHeader | undefined;
		const layout = list as unknown as NativeListLayout;
		if (!header || !["current", "all"].includes(header.scope) ||
			!Array.isArray(layout.filteredSessions) || !Number.isInteger(layout.selectedIndex) ||
			!Number.isInteger(layout.maxVisible) || typeof layout.searchInput?.render !== "function" ||
			!("confirmingDeletePath" in layout)) {
			dispose();
			throw new Error("현재 pi의 세션 목록 구조가 변경되어 아카이브 화면을 구성할 수 없습니다.");
		}

		const nativeHeaderRender = header.render.bind(header);
		header.render = (width) => {
			const lines = nativeHeaderRender(width);
			const title = `${archived ? "Archived Sessions" : "Archive Sessions"} (${header.scope === "all" ? "All" : "Current Folder"})`;
			const sortLabel = { threaded: "Threaded", recent: "Recent", relevance: "Fuzzy" }[header.sortMode];
			const details = [
				...(!archived ? [`Selected: ${checked.size}`] : []),
				...(header.loading ? ["Loading..."] : []),
				`Name: ${header.nameFilter === "named" ? "Named" : "All"}`, `Sort: ${sortLabel}`,
			].join("  ");
			const left = truncateToWidth(theme.bold(title), width, "");
			const right = truncateToWidth(theme.fg("muted", details), Math.max(0, width - visibleWidth(left) - 2), "");
			lines[0] = right ? `${left}${" ".repeat(width - visibleWidth(left) - visibleWidth(right))}${right}` : left;
			return lines;
		};
		if (!archived) {
			const nativeListRender = list.render.bind(list);
			list.render = (width) => {
				const innerWidth = Math.max(1, width - 4);
				const lines = nativeListRender(innerWidth);
				const { filteredSessions, selectedIndex, maxVisible } = layout;
				// Native layout: input, blank line, visible rows, optional scroll hint.
				const rowStart = layout.searchInput.render(innerWidth).length + 1;
				const start = Math.max(0, Math.min(selectedIndex - Math.floor(maxVisible / 2), filteredSessions.length - maxVisible));
				for (let i = 0; i < Math.min(maxVisible, filteredSessions.length - start); i++) {
					const selected = checked.has(filteredSessions[start + i].session.path);
					lines[rowStart + i] = theme.fg(selected ? "accent" : "dim", selected ? "[x] " : "[ ] ") + lines[rowStart + i];
				}
				return lines.map((line) => truncateToWidth(line, width));
			};
		}

		const toggle = (paths: string[]) => {
			const uncheck = paths.every((path) => checked.has(path));
			for (const path of paths) {
				if (uncheck) checked.delete(path);
				else checked.add(path);
			}
			render();
		};
		const nativeDelete = list.onDeleteSession;
		list.onDeleteSession = async (path) => {
			await nativeDelete?.(path);
			if (!existsSync(path)) checked.delete(path);
			render();
		};
		const nativeInput = list.handleInput.bind(list);
		list.handleInput = (data) => {
			// Rename bypasses list input; delete confirmation must keep native keys.
			if (layout.confirmingDeletePath !== null) return nativeInput(data);
			const path = list.getSelectedSessionPath();
			if (archived && matchesKey(data, "ctrl+u")) {
				if (path) {
					resume = false;
					list.onSelect?.(path);
				}
			} else if (!archived && matchesKey(data, "ctrl+space")) {
				if (path) toggle([path]);
			} else if (!archived && matchesKey(data, "ctrl+a")) {
				if (header.loading) list.onError?.("목록을 모두 불러온 뒤 전체 선택하십시오.");
				else toggle(layout.filteredSessions.map(({ session }) => session.path));
			} else if (!archived && checked.size && keybindings.matches(data, "tui.select.confirm")) {
				list.onSelect?.(checked.values().next().value!);
			} else {
				nativeInput(data);
			}
		};
		const actionHint = archived
			? "Enter: 복원 후 재개 / Ctrl+U: 복원만"
			: "Ctrl+Space: 선택 / Ctrl+A: 검색 결과 전체 선택·해제 / Enter: 보관";
		const nativeRender = selector.render.bind(selector);
		selector.render = (width) => [
			truncateToWidth(theme.fg("accent", actionHint), width),
			truncateToWidth(theme.fg("muted", "다른 pi에서 열린 세션은 닫은 뒤 이동하십시오."), width),
			...nativeRender(width),
		];
		// Return the native focus/input/invalidation implementation, not a proxy.
		return Object.assign(selector, { dispose });
	});
}
