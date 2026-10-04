// 실행: node readonly-shell.test.ts
import { checkReadOnlyShell } from "./readonly-shell.ts";

const allow = [
	"git log --oneline -20",
	"git log --oneline | head -20",
	"git --no-pager log -p -- src/a.ts",
	'git -C "my dir" status --short',
	'git log --format="%h %s" -5',
	"git diff HEAD~1 --stat",
	"git show HEAD:package.json",
	"git branch",
	"git branch -a -vv",
	"git branch --list 'feat*'",
	"git tag -l",
	"git remote -v",
	"git stash list",
	"git config --get user.name",
	"git reflog -n 10",
	"cd sub && git status",
	"ls -la 2>&1",
	"ls nope 2>/dev/null",
	'grep "a|b" file.txt',
	"grep 'x > y' file.txt",
	"rg -n foo src | wc -l",
	"find . -name '*.ts' -type f",
	"cat a.txt; cat b.txt",
	"sort -n x.txt",
	"tail -n 50 log.txt",
	"/usr/bin/git status",
	"grep 'a;rm x' f.txt",
	'grep "a \\" > b" f.txt',
	"git log -- 'a b.ts' | grep -c x",
];

const deny = [
	"",
	"git commit -m x",
	"git push",
	"git checkout main",
	"git reset --hard",
	"git branch -D old",
	"git branch newname",
	"git tag v1",
	"git remote add o url",
	"git stash",
	"git config user.name x",
	"git -c core.pager=x log",
	"git log --output=out.txt",
	"git diff --ext-diff",
	"echo a > f.txt",
	"cat a >> b",
	"cat < a",
	"rm x; git log",
	"git log && rm -rf x",
	"ls | xargs rm",
	"echo `rm x`",
	'echo "$(rm x)"',
	"find . -delete",
	"find . -exec rm {} ;",
	"sort -o out.txt in.txt",
	"tail -f log.txt",
	"sleep 10 &",
	"FOO=1 git log",
	"npm install",
	"python -c 'print(1)'",
	"sed -i s/a/b/ f",
	"ls\nrm x",
	"git branch -l -D old",
	"grep x f || rm f",
	"ls 2>/dev/null > out.txt",
];

let fail = 0;
for (const c of allow) {
	const r = checkReadOnlyShell(c);
	if (r !== null) {
		fail++;
		console.log(`FAIL allow: ${JSON.stringify(c)} -> ${r}`);
	}
}
for (const c of deny) {
	const r = checkReadOnlyShell(c);
	if (r === null) {
		fail++;
		console.log(`FAIL deny:  ${JSON.stringify(c)}`);
	} else console.log(`ok deny:   ${JSON.stringify(c)} -> ${r}`);
}
const specAllow = ["openspec list --json", "openspec context --json", "openspec new change a --schema b", "openspec status | grep x", "openspec.cmd status"];
const specDeny = ["openspec x; rm y", "openspec x > f", "openspec x && curl z", "openspec $(whoami)"];
for (const c of specAllow) {
	const r = checkReadOnlyShell(c, ["openspec"]);
	if (r) { fail++; console.log(`FAIL spec allow: ${JSON.stringify(c)} -> ${r}`); }
}
for (const c of specDeny) {
	if (!checkReadOnlyShell(c, ["openspec"])) { fail++; console.log(`FAIL spec deny: ${JSON.stringify(c)}`); }
}
if (!checkReadOnlyShell("openspec list")) { fail++; console.log("FAIL: openspec allowed without extra"); }
console.log(fail ? `${fail} failed` : `all ${allow.length + deny.length} passed`);
process.exit(fail ? 1 : 0);
