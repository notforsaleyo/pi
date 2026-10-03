# nofs-agent-modes

Shift+Tab 으로 도는 에이전트 모드: PLAN → SPEC → BASH.

| 모드 | 허용 |
|---|---|
| PLAN | read/grep/find/ls, 읽기 전용 bash, codemode |
| SPEC | PLAN + edit/write (`./openspec/` 하위만) |
| BASH | 전부 (powershell, worker 위임 포함) |

- 제한은 `tool_call` 훅에서 건다. codemode 안의 중첩 호출도 같은 훅을 거친다.
- 도구 목록과 시스템 프롬프트는 모드와 무관하게 고정 (프롬프트 캐시 보존). 현재 모드는 매 요청 끝 `<system-reminder>` 로만 알린다.
- 입력창 색/라벨은 `globalThis.__piAgentMode` 를 통해 `../nofs-theme/input-box.ts` 가 그린다.

## 읽기 전용 bash 판별 (`readonly-shell.ts`)

목적은 샌드박스가 아니라 **실수 방지**다. 흔히 일어날 법한 쓰기/실행만 잡고, 함수는 작게 유지한다.

- 리다이렉션(`>`, `<`; 단 `2>&1`, `>/dev/null` 은 허용), 명령 치환(`` ` ``, `$(`), 백그라운드 `&`, 여러 줄은 차단
- `;`, `&&`, `||`, `|` 로 나눈 모든 세그먼트가 허용 목록을 통과해야 한다
- 첫 단어가 `ALLOWED` 에 없으면 차단. git 은 `GIT_READ`(통째 허용) 또는 `checkGit` 의 서브커맨드별 규칙
- 개별 플래그 규칙: `find -exec/-delete/...`, `sort -o`, `tail -f`, `git --output/--ext-diff`, git 전역 옵션은 `-C`, `--no-pager` 만

### 읽기 전용인데 막히는 명령이 있을 때

1. 정말 아무것도 쓰거나 실행하지 않는 명령인지 확인한다 (출력 파일 옵션, 외부 프로그램 실행 옵션 등).
2. `ALLOWED`(일반 명령) 또는 `GIT_READ`/`checkGit`(git) 에 추가하고, 위험한 플래그가 있으면 `checkSegment` 에 규칙을 넣는다.
3. `readonly-shell.test.ts` 의 `allow`/`deny` 표에 케이스를 추가하고 `node readonly-shell.test.ts` 로 확인한다.
4. 수정은 BASH 모드에서만 가능하다. PLAN/SPEC 에서 막혔다면 우회하지 말고 사용자에게 알린다.

일부러 넣지 않은 것: sed, awk, xargs, uniq, env, curl, 인터프리터(python/node 등) — 쓰기/실행 우회 경로가 많다.
