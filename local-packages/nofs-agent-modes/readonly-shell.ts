// PLAN/SPEC 모드에서 bash 명령이 '읽기 전용'인지 판별한다.
// 샌드박스가 아니라 실수 방지용: 흔한 쓰기/실행만 잡고, 나머지는 허용 목록에서 빠지는 것으로 막는다.
// 반환: null = 통과, 문자열 = 차단 사유

const ALLOWED = new Set(
	"ls cd pwd cat head tail wc stat du tree which echo printf date basename dirname realpath diff cmp grep egrep fgrep rg jq sort find git".split(" "),
);

// 명령별로 막는 인자 (인자 하나하나에 검사)
const DENY_ARG: Record<string, RegExp> = {
	find: /^-(exec|execdir|ok|okdir|delete|fprint\w*|fls)$/,
	sort: /^(--output|-\w*o)/,
	tail: /^(--follow|-\w*[fF])/,
	git: /^(--output|--ext-diff)/,
};

// 통째로 허용하는 git 서브커맨드
const GIT_READ = new Set(
	"log show diff status blame shortlog describe rev-parse rev-list ls-files ls-tree ls-remote merge-base name-rev for-each-ref show-ref diff-tree cat-file grep".split(" "),
);

// 조회 형태일 때만 허용하는 git 서브커맨드
const isList = (a: string[]) => a.includes("-l") || a.includes("--list");
const flagsOrListed = (re: RegExp) => (a: string[]) => a.every((x) => re.test(x) || (!x.startsWith("-") && isList(a)));
const GIT_RULES: Record<string, (a: string[]) => boolean> = {
	branch: flagsOrListed(/^(-[arv]+|-l|--(list|all|remotes|verbose|show-current))$/),
	tag: flagsOrListed(/^(-l|--list|-n\d*)$/),
	remote: (a) => /^(|-v|--verbose|show|get-url)$/.test(a[0] ?? ""),
	stash: (a) => /^(list|show)$/.test(a[0] ?? ""),
	config: (a) =>
		/^(get|list)$/.test(a[0] ?? "") ||
		(a.some((x) => /^(--get(-all|-regexp)?|--list|-l)$/.test(x)) && !a.some((x) => /^(--(add|unset|replace|rename|remove|edit)|-e$)/.test(x))),
	worktree: (a) => a[0] === "list",
	submodule: (a) => a[0] === "status",
	reflog: (a) => !a[0] || a[0] === "show" || a[0].startsWith("-"),
};

function checkGit(args: string[]): string | null {
	let i = 0;
	while (args[i]?.startsWith("-")) {
		if (args[i] === "-C") i += 2;
		else if (args[i] === "--no-pager") i++;
		else return `git global option ${args[i]} is not allowed`;
	}
	const [sub, ...rest] = args.slice(i);
	if (!sub || GIT_READ.has(sub) || GIT_RULES[sub]?.(rest)) return null;
	return `git ${args.slice(i).join(" ")} is not read-only`;
}

// masked 기준으로 단어 위치를 찾고, 내용은 원본에서 따옴표만 벗겨 가져온다
function checkSegment(masked: string, src: string, extra: string[]): string | null {
	const [raw, ...args] = [...masked.matchAll(/\S+/g)].map((w) => src.slice(w.index, w.index + w[0].length).replace(/["']/g, ""));
	if (!raw) return null;
	const cmd = raw.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd)$/i, "").toLowerCase();
	if (!ALLOWED.has(cmd) && !extra.includes(cmd)) return `"${raw}" is not in the read-only allowlist`;
	const bad = DENY_ARG[cmd] && args.find((a) => DENY_ARG[cmd].test(a));
	if (bad) return `${cmd} ${bad} is not allowed`;
	return cmd === "git" ? checkGit(args) : null;
}

export function checkReadOnlyShell(command: string, extra: string[] = []): string | null {
	if (!command.trim()) return "empty command";
	if (/[\r\n]/.test(command)) return "multi-line commands are not allowed";
	if (/`|\$\(/.test(command)) return "command substitution is not allowed";

	// 따옴표 안·이스케이프를 같은 길이로 가리고(구분자 오인 방지), 무해한 리다이렉션(2>&1, >/dev/null)은 지운다
	const blank = (s: string) => " ".repeat(s.length);
	const masked = command
		.replace(/'[^']*'|"(?:\\.|[^"\\])*"|\\./g, (s) => "x".repeat(s.length))
		.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, blank);
	if (/[<>]/.test(masked)) return "redirection is not allowed";

	// ;, &&, ||, | 로 나눈 모든 세그먼트를 검사
	let start = 0;
	for (const end of [...[...masked.matchAll(/&&|\|\||[;|]/g)], null]) {
		const stop = end ? end.index : masked.length;
		const seg = masked.slice(start, stop);
		if (seg.includes("&")) return "background execution (&) is not allowed";
		const reason = checkSegment(seg, command.slice(start, stop), extra);
		if (reason) return reason;
		if (end) start = end.index + end[0].length;
	}
	return null;
}
