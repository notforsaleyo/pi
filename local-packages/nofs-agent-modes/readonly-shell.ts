// PLAN/SPEC 모드에서 bash 명령이 '읽기 전용'인지 판별한다.
// 샌드박스가 아니라 실수 방지용: 흔히 일어날 법한 쓰기/실행만 잡고, 나머지는 허용 목록에서 빠지는 것으로 막는다.
// 반환: null = 통과, 문자열 = 차단 사유

const ALLOWED = new Set(
	"ls cd pwd cat head tail wc stat du tree which echo printf date basename dirname realpath diff cmp grep egrep fgrep rg jq sort find git".split(
		" ",
	),
);

// 통째로 허용하는 git 서브커맨드
const GIT_READ = new Set(
	"log show diff status blame shortlog describe rev-parse rev-list ls-files ls-tree ls-remote merge-base name-rev for-each-ref show-ref diff-tree cat-file grep".split(
		" ",
	),
);

// 따옴표 안과 백슬래시 이스케이프를 같은 길이의 'x' 로 가린다 (구분자/리다이렉션 오인 방지)
function mask(s: string): string {
	let out = "";
	let q: string | null = null;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (q) {
			if (c === q) {
				q = null;
				out += c;
			} else if (c === "\\" && q === '"' && i + 1 < s.length) {
				out += "xx";
				i++;
			} else out += "x";
			continue;
		}
		if (c === "'" || c === '"') q = c;
		else if (c === "\\" && i + 1 < s.length) {
			out += "xx";
			i++;
			continue;
		}
		out += c;
	}
	return out;
}

// 공백 위치는 마스킹본 기준으로 찾아서 따옴표 안의 공백으로는 나누지 않는다
const words = (masked: string, src: string) =>
	[...masked.matchAll(/\S+/g)].map((w) => src.slice(w.index, w.index! + w[0].length).replace(/["']/g, ""));

function checkGit(args: string[]): string | null {
	let i = 0;
	while (i < args.length && args[i].startsWith("-")) {
		if (args[i] === "-C") i += 2;
		else if (args[i] === "--no-pager") i++;
		else return `git global option ${args[i]} is not allowed`;
	}
	const sub = args[i];
	const rest = args.slice(i + 1);
	if (!sub) return null;
	const bad = rest.find((a) => a.startsWith("--output") || a === "--ext-diff");
	if (bad) return `git ${bad} is not allowed`;
	if (GIT_READ.has(sub)) return null;

	const first = rest[0];
	const onlyFlags = (re: RegExp) => {
		const listing = rest.some((a) => a === "-l" || a === "--list");
		return rest.every((a) => re.test(a) || (listing && !a.startsWith("-")));
	};
	let ok = false;
	switch (sub) {
		case "branch":
			ok = onlyFlags(/^(-a|-r|-v|-vv|-l|--list|--show-current|--all|--remotes|--verbose)$/);
			break;
		case "tag":
			ok = onlyFlags(/^(-l|--list|-n\d*)$/);
			break;
		case "remote":
			ok = !first || first === "-v" || first === "--verbose" || first === "show" || first === "get-url";
			break;
		case "stash":
			ok = first === "list" || first === "show";
			break;
		case "config":
			ok =
				first === "get" ||
				first === "list" ||
				(rest.some((a) => /^(--get|--get-all|--get-regexp|--list|-l)$/.test(a)) &&
					!rest.some((a) => /^(--add|--unset|--unset-all|--replace-all|--rename-section|--remove-section|-e|--edit)$/.test(a)));
			break;
		case "worktree":
			ok = first === "list";
			break;
		case "submodule":
			ok = first === "status";
			break;
		case "reflog":
			ok = !first || first === "show" || first.startsWith("-");
			break;
	}
	return ok ? null : `git ${[sub, ...rest].join(" ")} is not read-only`;
}

function checkSegment(masked: string, src: string): string | null {
	const [raw, ...args] = words(masked, src);
	if (!raw) return null;
	const cmd = raw.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();
	if (!ALLOWED.has(cmd)) return `"${raw}" is not in the read-only allowlist`;
	switch (cmd) {
		case "git":
			return checkGit(args);
		case "find": {
			const bad = args.find((a) => /^-(exec|execdir|ok|okdir|delete|fprint\w*|fls)$/.test(a));
			return bad ? `find ${bad} is not allowed` : null;
		}
		case "sort": {
			const bad = args.find((a) => a.startsWith("--output") || /^-[a-zA-Z]*o/.test(a));
			return bad ? `sort ${bad} writes a file` : null;
		}
		case "tail": {
			const bad = args.find((a) => a.startsWith("--follow") || /^-[a-zA-Z]*[fF]/.test(a));
			return bad ? `tail ${bad} never exits` : null;
		}
	}
	return null;
}

export function checkReadOnlyShell(command: string): string | null {
	if (!command.trim()) return "empty command";
	if (/[\r\n]/.test(command)) return "multi-line commands are not allowed";
	if (/`|\$\(/.test(command)) return "command substitution is not allowed";

	// 무해한 리다이렉션(2>&1, >/dev/null)은 두 문자열에서 같은 위치를 공백으로 지운다
	let src = command;
	let m = mask(command);
	for (const hit of [...m.matchAll(/\d?>&\d|\d?>\s*\/dev\/null/g)]) {
		const blank = " ".repeat(hit[0].length);
		const at = hit.index!;
		src = src.slice(0, at) + blank + src.slice(at + blank.length);
		m = m.slice(0, at) + blank + m.slice(at + blank.length);
	}
	if (/[<>]/.test(m)) return "redirection is not allowed";

	// ;, &&, ||, | 로 나눠 모든 세그먼트를 검사
	const sep = /&&|\|\||[;|]/g;
	let start = 0;
	const segs: [string, string][] = [];
	for (const hit of m.matchAll(sep)) {
		segs.push([m.slice(start, hit.index), src.slice(start, hit.index)]);
		start = hit.index! + hit[0].length;
	}
	segs.push([m.slice(start), src.slice(start)]);
	for (const [ms, ss] of segs) {
		if (ms.includes("&")) return "background execution (&) is not allowed";
		const reason = checkSegment(ms, ss);
		if (reason) return reason;
	}
	return null;
}
