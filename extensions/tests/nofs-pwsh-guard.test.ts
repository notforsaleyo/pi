import assert from "node:assert/strict";
import { test } from "node:test";
import install from "../nofs-pwsh-guard.ts";

let handler: (event: any) => Promise<any>;
install({ on: (_name: string, fn: typeof handler) => { handler = fn; } } as any);
const check = (command: string) => handler({ toolName: "powershell", input: { command } });

test("guard permits strings, comments and Windows find.exe syntax", async () => {
  for (const command of [
    "'grep'", '"grep"', "Write-Output ok # note; grep",
    "# grep; sed\nWrite-Output ok", "Write-Output '<# ; grep #>'",
    "<# grep; <# sed #> awk #> Write-Output ok",
    'find /C /V "" input.txt', 'find "foo" input.txt',
    'find "-name" input.txt', 'Write-Output foo | find "foo"',
  ]) assert.equal(await check(command), undefined, command);
});

test("guard still blocks actual unsupported commands across separators and comments", async () => {
  for (const command of [
    "grep foo file", "& 'grep' foo", 'Write-Output ok; grep foo',
    "Write-Output ok # comment; sed\ngrep foo",
    "<# comment #> grep foo", "Write-Output ok | grep foo",
    "Write-Output ok && grep foo", "Write-Output ok || grep foo",
    "find . -name '*.ts'", "find . -type f", "rm -rf tmp",
  ]) assert.equal((await check(command))?.block, true, command);
});

test("guard ignores other tools and malformed input", async () => {
  assert.equal(await handler({ toolName: "read", input: { command: "grep" } }), undefined);
  assert.equal(await handler({ toolName: "powershell", input: { command: null } }), undefined);
});
