# nofs-agent-modes

Shift+Tab 으로 도는 에이전트 모드: PLAN → SPEC → BASH.

모드 이름 `BASH` 는 "구현/실행" 모드의 라벨일 뿐, `bash` 도구나 bash 셸과 무관하다. 이 환경의 셸 도구는 `powershell` 이다.

모드는 **사용자 의도의 표현**이다. 도구 차단/명령어 필터는 없고, 에이전트가 프롬프트를 보고 스스로 판단한다. 안전장치는 이 확장 바깥에서 따로 둔다.

| 모드 | 의도 |
|---|---|
| PLAN | 생각과 계획만. 순수 읽기(powershell 포함)는 에이전트 판단으로 수행, 쓰기/실행은 BASH 전환을 요청 |
| SPEC | PLAN + `./openspec/` 산출물만 편집 가능 (읽기는 전부) |
| BASH | 구현/실행 전부. "ㄱㄱ" = 지금까지의 계획을 실행 |

- 시스템 프롬프트(`agent_modes` 섹션)는 고정, 현재 모드는 매 요청 끝 `<system-reminder>` 로만 알린다 (프롬프트 캐시 보존).
- 입력창 색/라벨은 `globalThis.__piAgentMode` 를 통해 `../nofs-theme/input-box.ts` 가 그린다.
