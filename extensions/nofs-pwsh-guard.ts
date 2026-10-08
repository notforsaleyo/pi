// nofs-pwsh-guard
// block: powershell에서 Windows에 없거나 bash와 의미가 달라 반드시 실패하는 명령을 호출하면 차단한다.
//
// 검사는 fail-open이다. 핸들러 오류는 호출을 막지 않는다
// (tool_call 핸들러 오류는 도구를 막는 fail-safe이므로 try/catch로 감싼다).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

// 이 환경에서 존재하지 않아 반드시 실패하는 명령. 파이프 뒤에서도 실패하므로 위치 무관.
const MISSING: Record<string, string> = {
  grep: "the grep tool",
  egrep: "the grep tool",
  fgrep: "the grep tool",
  sed: "the edit tool or PowerShell -replace",
  awk: "PowerShell object pipeline (ForEach-Object, Select-Object)",
  cut: "PowerShell -split or Select-Object",
  uniq: "Select-Object -Unique or Sort-Object -Unique",
  xargs: "ForEach-Object",
  head: "the read tool (limit) or Select-Object -First",
  tail: "the read tool (offset) or Select-Object -Last",
  wc: "Measure-Object",
  which: "Get-Command",
  touch: "New-Item or Set-Content",
  chmod: "nothing (Windows). Use icacls only if permissions are really needed",
  chown: "nothing (Windows)",
  export: "$env:NAME = 'value'",
  unset: "Remove-Item Env:NAME",
  source: "dot-sourcing (. ./file.ps1)",
  basename: "Split-Path -Leaf",
  dirname: "Split-Path -Parent",
}

// find는 C:\Windows\System32\find.exe(문자열 검색 도구)라서 bash의 find 인자로는 항상 실패한다.
// 파이프 뒤에서 문자열을 거르는 용도(`x | find "foo"`)는 정상이므로 파이프 뒤는 통과시킨다.
const FIND_MSG = "the find tool (file search)"

type Segment = { text: string; afterPipe: boolean }

// 따옴표를 인식해서 ; && || | 개행으로 명령을 나눈다.
function splitSegments(cmd: string): Segment[] {
  const segs: Segment[] = []
  let buf = ""
  let quote: "'" | '"' | null = null
  let afterPipe = false
  const push = (sepIsPipe: boolean) => {
    segs.push({ text: buf, afterPipe })
    buf = ""
    afterPipe = sepIsPipe
  }
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]
    if (quote) {
      buf += ch
      if (ch === "`" && quote === '"') {
        buf += cmd[++i] ?? ""
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === "`") {
      buf += ch + (cmd[++i] ?? "")
    } else if (ch === "'" || ch === '"') {
      quote = ch
      buf += ch
    } else if (ch === ";" || ch === "\n") {
      push(false)
    } else if (ch === "&" && cmd[i + 1] === "&") {
      i++
      push(false)
    } else if (ch === "|" && cmd[i + 1] === "|") {
      i++
      push(false)
    } else if (ch === "|") {
      push(true)
    } else {
      buf += ch
    }
  }
  segs.push({ text: buf, afterPipe })
  return segs
}

function firstToken(segText: string): { name: string; rest: string } | null {
  const s = segText.replace(/^[\s&]+/, "")
  const m = s.match(/^("[^"]+"|'[^']+'|[^\s]+)([\s\S]*)$/)
  if (!m) return null
  const name = m[1].replace(/^["']|["']$/g, "").toLowerCase()
  // 변수, 괄호, 스크립트 블록, 경로 호출 등은 명령 이름으로 취급하지 않는다.
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) return null
  return { name, rest: m[2] }
}

// 반드시 실패하는 명령이면 차단 사유를 돌려준다.
function findViolation(cmd: string): string | null {
  for (const seg of splitSegments(cmd)) {
    const tok = firstToken(seg.text)
    if (!tok) continue
    const { name, rest } = tok

    if (name in MISSING) {
      return `'${name}' does NOT EXIST on this Windows environment and will ALWAYS fail. Use: ${MISSING[name]}.`
    }
    if (name === "find" && !seg.afterPipe) {
      return `'find' is find.exe (string search), NOT bash find. It will ALWAYS fail with bash arguments. Use: ${FIND_MSG}.`
    }
    if ((name === "rm" || name === "rmdir") && /(^|\s)-(rf|fr)(\s|$)/i.test(rest)) {
      return `'rm -rf' is a parameter ERROR in PowerShell. Use: Remove-Item -Recurse -Force.`
    }
  }
  return null
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event: any) => {
    try {
      if (event.toolName !== "powershell") return
      const cmd: unknown = event.input?.command
      if (typeof cmd !== "string") return

      const violation = findViolation(cmd)
      if (violation) {
        return {
          block: true,
          reason: `Blocked: this powershell command WILL FAIL on this system. Do not retry it. ${violation}`,
        }
      }
    } catch {
      // fail-open
    }
  })
}
